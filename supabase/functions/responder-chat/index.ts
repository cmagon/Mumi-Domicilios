// El admin responde a un cliente desde el micrositio. Se envía por el número del bot (WhatsApp Cloud API),
// se guarda en el historial como mensaje del equipo y el bot se calla en ese chat mientras la persona atiende.
// Solo se puede escribir libremente dentro de las 24 h posteriores al último mensaje del cliente.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { marcarLeidoSolo, sendAudio, sendImage, sendText, sendVideo } from '../whatsapp-webhook/wa.ts'
import { transcribir } from '../whatsapp-webhook/ai.ts'
import { apiKey } from '../whatsapp-webhook/config.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = Deno.env.get('SUPABASE_URL')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return json({ ok: false, error: 'No autenticado' }, 401)
  const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: perfil } = await sb.from('perfiles').select('rol').eq('user_id', u.user.id).maybeSingle()
  if (perfil?.rol !== 'admin') return json({ ok: false, error: 'Sin permiso' }, 403)

  const { telefono, texto, imagen_path, audio_path, responder_a, medio_url, medio_tipo } = await req.json().catch(() => ({}))
  // Cita (reply) de WhatsApp: solo se acepta un mensaje de este mismo chat
  let replyTo: string | null = null, cita: string | null = null
  if (responder_a) {
    const { data: q } = await sb.from('mensajes').select('wa_id,contenido').eq('telefono', telefono).eq('wa_id', String(responder_a)).maybeSingle()
    if (q?.wa_id) { replyTo = q.wa_id; cita = String(q.contenido).slice(0, 200) }
  }
  const aud = audio_path ? String(audio_path) : ''
  const msg = String(texto ?? '').trim()
  const img = imagen_path ? String(imagen_path) : ''
  // Foto o video ya guardado del catálogo/biblioteca (URL pública de nuestro almacenamiento)
  const medio = medio_url ? String(medio_url) : ''
  if (medio && !medio.startsWith(`${url}/storage/v1/object/public/catalogo/`)) return json({ ok: false, error: 'Archivo no válido' }, 400)
  if (!telefono || (!msg && !img && !aud && !medio)) return json({ ok: false, error: 'Falta el teléfono o el mensaje' }, 400)
  if (aud && !aud.startsWith('salientes/')) return json({ ok: false, error: 'Ruta de audio no válida' }, 400)
  if (img && !img.startsWith('salientes/')) return json({ ok: false, error: 'Ruta de imagen no válida' }, 400)
  if (msg.length > 4000) return json({ ok: false, error: 'El mensaje es demasiado largo' }, 400)

  // Ventana de 24 h de WhatsApp
  const { data: ult } = await sb.from('mensajes').select('creado_en').eq('telefono', telefono).eq('rol', 'user').order('creado_en', { ascending: false }).limit(1).maybeSingle()
  if (!ult || Date.now() - new Date(ult.creado_en).getTime() > 24 * 3600 * 1000)
    return json({ ok: false, ventana_cerrada: true, error: 'Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite plantillas aprobadas. Podrás responder cuando él escriba de nuevo.' })

  let waId: string | null | undefined
  let despues: (() => Promise<void>) | null = null
  let transcripcion = ''
  if (aud) {
    const { data: firmada } = await sb.storage.from('comprobantes').createSignedUrl(aud, 600)
    if (!firmada?.signedUrl) return json({ ok: false, error: 'No se encontró el audio subido' })
    waId = await sendAudio(telefono, firmada.signedUrl, replyTo)
    // La transcripción (para el historial y para que el bot aprenda) va en segundo plano: no hace esperar el envío
    despues = async () => { try {
      const { data: c } = await sb.from('config').select('clave,valor')
      const cfg = Object.fromEntries((c ?? []).map((r) => [r.clave, r.valor])) as Record<string, string>
      const motor = cfg.motor_audio === 'openai' ? 'openai' : 'gemini'
      const key = await apiKey(sb, cfg, motor)
      const { data: f } = await sb.storage.from('comprobantes').download(aud)
      if (key && f) transcripcion = (await transcribir(motor, key, new Uint8Array(await f.arrayBuffer()), f.type || 'audio/mpeg', cfg.modelo_ia && cfg.proveedor_ia === 'gemini' ? cfg.modelo_ia : undefined)).trim()
      if (transcripcion && waId) await sb.from('mensajes').update({ contenido: `🎤 Nota de voz del equipo: ${transcripcion}` }).eq('wa_id', waId)
    } catch (e) { console.error('transcripción del audio del equipo', e) } }
  } else if (medio) {
    waId = medio_tipo === 'video' ? await sendVideo(telefono, medio, msg || undefined) : await sendImage(telefono, medio, msg || undefined, replyTo)
  } else if (img) {
    const { data: firmada } = await sb.storage.from('comprobantes').createSignedUrl(img, 600)
    if (!firmada?.signedUrl) return json({ ok: false, error: 'No se encontró la imagen subida' })
    waId = await sendImage(telefono, firmada.signedUrl, msg || undefined, replyTo)
  } else waId = await sendText(telefono, msg, replyTo)
  if (!waId) return json({ ok: false, error: 'WhatsApp no aceptó el mensaje. Revisa el token en los secrets o los registros de la función.' })
  const ahora = new Date().toISOString()
  const fila = { telefono, rol: 'admin', contenido: aud ? `🎤 Nota de voz del equipo${transcripcion ? ': ' + transcripcion : ''}` : (msg || (medio_tipo === 'video' ? '🎬 Video' : '📷 Foto')), wa_id: waId, ...(aud ? { media_path: aud } : img ? { media_path: img } : {}) }
  const { error: ei } = await sb.from('mensajes').insert({ ...fila, cita })
  if (ei) await sb.from('mensajes').insert(fila) // por si la migración 0040 aún no se corrió
  // La persona toma el chat: el bot se calla (y se reactiva solo pasadas "horas_humano" h sin que escribas)
  const toma = sb.from('conversaciones').upsert({ telefono, humano: true, humano_desde: ahora, admin_leido_en: ahora }, { onConflict: 'telefono' })
  // La transcripción del audio, la palomita azul del último mensaje del cliente (la persona ya leyó) y la toma del chat van en paralelo / en segundo plano
  // deno-lint-ignore no-explicit-any
  const dif = despues as (() => Promise<void>) | null
  if (dif) (globalThis as any).EdgeRuntime?.waitUntil(dif())
  const marcar = (async () => {
    const { data: ultU } = await sb.from('mensajes').select('wa_id').eq('telefono', telefono).eq('rol', 'user').not('wa_id', 'is', null).order('creado_en', { ascending: false }).limit(1).maybeSingle()
    if (ultU?.wa_id) await marcarLeidoSolo(ultU.wa_id)
  })()
  await Promise.all([toma, marcar])
  return json({ ok: true })
})
