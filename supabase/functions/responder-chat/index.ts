// El admin responde a un cliente desde el micrositio. Se envía por el número del bot (WhatsApp Cloud API),
// se guarda en el historial como mensaje del equipo y el bot se calla en ese chat mientras la persona atiende.
// Solo se puede escribir libremente dentro de las 24 h posteriores al último mensaje del cliente.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendImage, sendText } from '../whatsapp-webhook/wa.ts'

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

  const { telefono, texto, imagen_path } = await req.json().catch(() => ({}))
  const msg = String(texto ?? '').trim()
  const img = imagen_path ? String(imagen_path) : ''
  if (!telefono || (!msg && !img)) return json({ ok: false, error: 'Falta el teléfono o el mensaje' }, 400)
  if (img && !img.startsWith('salientes/')) return json({ ok: false, error: 'Ruta de imagen no válida' }, 400)
  if (msg.length > 4000) return json({ ok: false, error: 'El mensaje es demasiado largo' }, 400)

  // Ventana de 24 h de WhatsApp
  const { data: ult } = await sb.from('mensajes').select('creado_en').eq('telefono', telefono).eq('rol', 'user').order('creado_en', { ascending: false }).limit(1).maybeSingle()
  if (!ult || Date.now() - new Date(ult.creado_en).getTime() > 24 * 3600 * 1000)
    return json({ ok: false, ventana_cerrada: true, error: 'Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite plantillas aprobadas. Podrás responder cuando él escriba de nuevo.' })

  let waId: string | null | undefined
  if (img) {
    const { data: firmada } = await sb.storage.from('comprobantes').createSignedUrl(img, 600)
    if (!firmada?.signedUrl) return json({ ok: false, error: 'No se encontró la imagen subida' })
    waId = await sendImage(telefono, firmada.signedUrl, msg || undefined)
  } else waId = await sendText(telefono, msg)
  if (!waId) return json({ ok: false, error: 'WhatsApp no aceptó el mensaje. Revisa el token en los secrets o los registros de la función.' })
  const ahora = new Date().toISOString()
  await sb.from('mensajes').insert({ telefono, rol: 'admin', contenido: msg || '📷 Foto', wa_id: waId, ...(img ? { media_path: img } : {}) })
  // La persona toma el chat: el bot se calla (y se reactiva solo pasadas "horas_humano" h sin que escribas)
  await sb.from('conversaciones').upsert({ telefono, humano: true, humano_desde: ahora, admin_leido_en: ahora }, { onConflict: 'telefono' })
  return json({ ok: true })
})
