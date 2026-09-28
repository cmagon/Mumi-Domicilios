import { createClient } from 'npm:@supabase/supabase-js@2'
import { chat, modeloPorDefecto, transcribir, type Provider, type Turn } from './ai.ts'
import { digits, downloadMedia, sendText, verifySignature } from './wa.ts'
import { TOOLS, ejecutar, fechaBogota, diaSemana, type Ctx } from './tools.ts'

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

async function cargarConfig() {
  const { data } = await sb.from('config').select('clave,valor')
  return Object.fromEntries((data ?? []).map((r) => [r.clave, r.valor])) as Record<string, string>
}

async function proveedor(cfg: Record<string, string>): Promise<Provider> {
  const { data } = await sb.from('config_secretos').select('valor').eq('clave', 'ia_api_key').maybeSingle()
  if (!data) throw new Error('API key de IA no configurada')
  const p = cfg.proveedor_ia === 'openai' ? 'openai' : 'claude'
  return { proveedor: p, apiKey: data.valor, modelo: cfg.modelo_ia || modeloPorDefecto(p) }
}

async function comandoAdmin(from: string, texto: string, cfg: Record<string, string>): Promise<boolean> {
  const t = texto.trim()
  if (/^hoy\s*:/i.test(t)) {
    const { data: prods } = await sb.from('productos').select('id,nombre').eq('activo', true)
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const hoy = fechaBogota(); const ok: string[] = []; const fallo: string[] = []
    for (const par of t.replace(/^hoy\s*:/i, '').split(',')) {
      const m = par.trim().match(/^(.+?)\s+(\d+)$/)
      const p = m && (prods ?? []).find((x) => norm(x.nombre).includes(norm(m[1])) || norm(m[1]).includes(norm(x.nombre).split(' ')[0]))
      if (!m || !p) { fallo.push(par.trim()); continue }
      await sb.from('stock_dia').upsert({ fecha: hoy, producto_id: p.id, cantidad_excedente: +m[2] }, { onConflict: 'fecha,producto_id' })
      ok.push(`${p.nombre}: ${m[2]}`)
    }
    await sendText(from, `Excedente de hoy actualizado:\n${ok.join('\n') || '—'}${fallo.length ? `\nNo entendí: ${fallo.join(', ')}` : ''}`)
    return true
  }
  const re = t.match(/^reanudar\s+(\d+)/i)
  if (re) {
    await sb.from('conversaciones').update({ humano: false }).eq('telefono', re[1])
    await sendText(from, `Bot reactivado para ${re[1]}`); return true
  }
  return false
}

async function comandoDomiciliario(from: string, texto: string): Promise<boolean> {
  if (texto.trim().toLowerCase() !== 'pedidos') return false
  const { data } = await sb.from('pedidos').select('numero,cliente_nombre,direccion,total,pagado,estado').in('estado', ['listo', 'en_ruta']).order('numero')
  await sendText(from, (data ?? []).length
    ? (data ?? []).map((p) => `#${p.numero} ${p.cliente_nombre} — ${p.direccion ?? 'recoge'} — ${p.pagado ? 'PAGADO' : 'COBRAR $' + p.total} (${p.estado})`).join('\n')
    : 'No tienes pedidos pendientes ✅')
  return true
}

async function botonDomiciliario(id: string, from: string) {
  const [accion, pedidoId] = id.split(':')
  if (accion === 'recogido') await sb.from('pedidos').update({ estado: 'en_ruta' }).eq('id', pedidoId)
  else if (accion === 'entregado') await sb.from('pedidos').update({ estado: 'entregado', pagado: true }).eq('id', pedidoId)
  else return
  await sendText(from, accion === 'recogido' ? '📦 Marcado como recogido' : '✅ Marcado como entregado')
}

async function manejar(msg: any) {
  const from: string = msg.from
  const cfg = await cargarConfig()
  const admins = (cfg.admin_numeros ?? '').split(',').map(digits).filter(Boolean)
  const domi = digits(cfg.domiciliario_numero ?? '')

  // Respuestas de botones del domiciliario
  if (msg.type === 'interactive' && from === domi) return botonDomiciliario(msg.interactive?.button_reply?.id ?? '', from)

  // Dedupe por id de mensaje de WhatsApp
  const { error: dup } = await sb.from('mensajes').insert({ wa_id: msg.id, telefono: from, rol: 'user', contenido: '…' })
  if (dup) return

  let texto = ''
  let comprobantePath: string | null = null
  try {
    if (msg.type === 'text') texto = msg.text.body
    else if (msg.type === 'audio') {
      const { bytes, mime } = await downloadMedia(msg.audio.id)
      const sttKey = Deno.env.get('OPENAI_API_KEY') ?? (cfg.proveedor_ia === 'openai'
        ? (await sb.from('config_secretos').select('valor').eq('clave', 'ia_api_key').maybeSingle()).data?.valor : null)
      if (!sttKey) { await sendText(from, 'Por ahora no puedo escuchar audios, ¿me lo escribes? 🙏'); return }
      texto = await transcribir(sttKey, bytes, mime)
    } else if (msg.type === 'image') {
      const { bytes, mime } = await downloadMedia(msg.image.id)
      comprobantePath = `${from}/${msg.id}.${mime.includes('png') ? 'png' : 'jpg'}`
      await sb.storage.from('comprobantes').upload(comprobantePath, bytes, { contentType: mime })
      await sb.from('conversaciones').upsert({ telefono: from, ultimo_comprobante: comprobantePath, actualizado_en: new Date().toISOString() })
      texto = '[El cliente envió una imagen, posiblemente el comprobante de pago]' + (msg.image.caption ? ' ' + msg.image.caption : '')
    } else { await sendText(from, 'Por ahora solo puedo leer texto, notas de voz e imágenes 🙂'); return }
  } catch (e) { console.error('media', e); await sendText(from, 'No pude procesar ese archivo, ¿lo intentas de nuevo?'); return }

  await sb.from('mensajes').update({ contenido: texto }).eq('wa_id', msg.id)

  if (admins.includes(from) && (await comandoAdmin(from, texto, cfg))) return
  if (from === domi && (await comandoDomiciliario(from, texto))) return

  const { data: conv } = await sb.from('conversaciones').select('humano,ultimo_comprobante').eq('telefono', from).maybeSingle()
  if (conv?.humano) return // el bot calla mientras atiende una persona

  const { data: hist } = await sb.from('mensajes').select('rol,contenido').eq('telefono', from).order('creado_en', { ascending: false }).limit(20)
  const history: Turn[] = (hist ?? []).reverse().map((m) => ({ role: m.rol, content: m.contenido }))
  while (history.length && history[0].role !== 'user') history.shift()

  const prov = await proveedor(cfg)
  const hoy = fechaBogota()
  const system = `${cfg.system_prompt}\n\n[Contexto del sistema] Hoy es ${diaSemana(hoy)} ${hoy} (hora de Colombia). ` +
    `Días de producción: ${cfg.dias_produccion}. Franjas de entrega: ${cfg.franjas_entrega}. Teléfono del chat: ${from}.`
  const ctx: Ctx = { sb, cfg, telefono: from, prov, comprobantePath: comprobantePath ?? conv?.ultimo_comprobante }

  let respuesta: string
  try { respuesta = await chat(prov, system, history, TOOLS, (n, a) => ejecutar(n, a, ctx)) }
  catch (e) { console.error('ia', e); respuesta = 'Dame un momento, en seguida te ayudo 🙏'; }
  if (respuesta) {
    await sendText(from, respuesta)
    await sb.from('mensajes').insert({ telefono: from, rol: 'assistant', contenido: respuesta })
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  if (req.method === 'GET') { // verificación del webhook de Meta
    if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === Deno.env.get('WHATSAPP_VERIFY_TOKEN'))
      return new Response(url.searchParams.get('hub.challenge'))
    return new Response('forbidden', { status: 403 })
  }
  const raw = await req.text()
  if (!(await verifySignature(raw, req.headers.get('x-hub-signature-256')))) return new Response('bad signature', { status: 401 })
  const body = JSON.parse(raw)
  const msgs = (body.entry ?? []).flatMap((e: any) => (e.changes ?? []).flatMap((c: any) => c.value?.messages ?? []))
  const work = Promise.all(msgs.map((m: any) => manejar(m).catch((e) => console.error('manejar', e))))
  EdgeRuntime.waitUntil(work)
  return new Response('ok')
})
