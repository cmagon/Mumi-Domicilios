import { createClient } from 'npm:@supabase/supabase-js@2'
import { chat, compactar, transcribir, type Provider } from './ai.ts'
import { direccionAprox } from './geo.ts'
import { registrarAlerta } from './alerts.ts'
import { apiKey, construirProveedor } from './config.ts'
import { digits, downloadMedia, marcarLeido, sendImage, sendText, verifySignature } from './wa.ts'
import { TOOLS, ejecutar, fechaBogota, diaSemana, pedidoActivo, type Ctx } from './tools.ts'

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

async function cargarConfig() {
  const { data } = await sb.from('config').select('clave,valor')
  return Object.fromEntries((data ?? []).map((r) => [r.clave, r.valor])) as Record<string, string>
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
    await sb.from('conversaciones').update({ humano: false, humano_desde: null }).eq('telefono', re[1])
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function manejar(msg: any, nombreWA?: string) {
  const from: string = msg.from
  const cfg = await cargarConfig()
  const admins = (cfg.admin_numeros ?? '').split(',').map(digits).filter(Boolean)
  const domi = digits(cfg.domiciliario_numero ?? '')

  // Respuestas de botones del domiciliario
  if (from === domi && (msg.type === 'interactive' || msg.type === 'button'))
    return botonDomiciliario(msg.interactive?.button_reply?.id ?? msg.button?.payload ?? '', from)

  // Dedupe por id de mensaje de WhatsApp
  const { error: dup } = await sb.from('mensajes').insert({ wa_id: msg.id, telefono: from, rol: 'user', contenido: '…' })
  if (dup) return

  await marcarLeido(msg.id)

  let texto = ''
  let comprobantePath: string | null = null
  try {
    if (msg.type === 'text') texto = msg.text.body
    else if (msg.type === 'audio') {
      const motor = cfg.motor_audio === 'openai' ? 'openai' : 'gemini'
      const key = await apiKey(sb, cfg, motor)
      if (!key) {
        await registrarAlerta(sb, cfg, 'audio', `Falta la API key de ${motor} para transcribir audios`)
        await sendText(from, 'Por ahora no puedo escuchar audios, ¿me lo escribes? 🙏'); return
      }
      try {
        const { bytes, mime } = await downloadMedia(msg.audio.id)
        texto = await transcribir(motor, key, bytes, mime, cfg.modelo_ia && cfg.proveedor_ia === 'gemini' ? cfg.modelo_ia : undefined)
      } catch (e) {
        await registrarAlerta(sb, cfg, 'audio', String(e))
        await sendText(from, 'No pude escuchar tu audio, ¿me lo escribes? 🙏'); return
      }
    } else if (msg.type === 'image') {
      const { bytes, mime } = await downloadMedia(msg.image.id)
      comprobantePath = `${from}/${msg.id}.${mime.includes('png') ? 'png' : 'jpg'}`
      await sb.storage.from('comprobantes').upload(comprobantePath, bytes, { contentType: mime })
      await sb.from('conversaciones').upsert({ telefono: from, ultimo_comprobante: comprobantePath, actualizado_en: new Date().toISOString() })
      texto = '[El cliente envió una imagen, posiblemente el comprobante de pago]' + (msg.image.caption ? ' ' + msg.image.caption : '')
    } else if (msg.type === 'location') {
      const l = msg.location ?? {}
      const aprox = await direccionAprox(Number(l.latitude), Number(l.longitude))
      await sb.from('conversaciones').upsert({ telefono: from, ultima_lat: l.latitude, ultima_lng: l.longitude,
        ultima_direccion_aprox: [l.name, l.address].filter(Boolean).join(', ') || aprox }, { onConflict: 'telefono' })
      texto = `[El cliente compartió su ubicación con el pin. ${[l.name, l.address].filter(Boolean).length ? 'Lugar: ' + [l.name, l.address].filter(Boolean).join(', ') + '. ' : ''}` +
        `Dirección aproximada detectada: ${aprox ?? 'no disponible'} (lat ${l.latitude}, lng ${l.longitude}). Es solo aproximada: dile en qué zona/barrio lo ubicas y pídele una seña (casa, conjunto, apto, punto de referencia). Al crear el pedido usa ubicacion_compartida=true.]`
    } else if (msg.type === 'sticker') texto = '[El cliente envió un sticker]'
    else if (msg.type === 'reaction') { await sb.from('mensajes').delete().eq('wa_id', msg.id); return } // reacciones: sin respuesta
    else { await sendText(from, 'Por ahora solo puedo leer texto, notas de voz, imágenes y ubicaciones 🙂'); return }
  } catch (e) { console.error('media', e); await sendText(from, 'No pude procesar ese archivo, ¿lo intentas de nuevo?'); return }

  // El cliente respondió (citó) un mensaje o una foto: se agrega qué mensaje es para que el bot entienda "quiero esta"
  if (msg.context?.id) {
    const { data: citado } = await sb.from('mensajes').select('contenido,rol').eq('wa_id', msg.context.id).maybeSingle()
    if (citado) texto = `[El cliente responde a ${citado.rol === 'assistant' ? 'este mensaje tuyo' : 'este mensaje suyo'}: «${String(citado.contenido).slice(0, 240)}»] ${texto}`
  }
  await sb.from('mensajes').update({ contenido: texto }).eq('wa_id', msg.id)
  // El cliente respondió: se cancela cualquier seguimiento pendiente
  await sb.from('conversaciones').upsert({ telefono: from, esperando: null, esperando_desde: null, seguimientos: 0, ultimo_cliente_en: new Date().toISOString() }, { onConflict: 'telefono' })

  if (admins.includes(from) && (await comandoAdmin(from, texto, cfg))) return
  if (from === domi && (await comandoDomiciliario(from, texto))) return

  const { data: conv } = await sb.from('conversaciones').select('humano,humano_desde,ultimo_comprobante').eq('telefono', from).maybeSingle()
  if (conv?.humano) {
    // El bot calla mientras atiende una persona, y se reactiva solo pasadas N horas (config: horas_humano)
    const horas = Number(cfg.horas_humano) > 0 ? Number(cfg.horas_humano) : 12
    const desde = conv.humano_desde ? new Date(conv.humano_desde).getTime() : 0
    if (Date.now() - desde < horas * 3600 * 1000) return
    await sb.from('conversaciones').update({ humano: false, humano_desde: null }).eq('telefono', from)
  }

  // Agrupa ráfagas: si el cliente sigue escribiendo, responde solo el último mensaje con todo el contexto
  const espera = cfg.espera_agrupar_seg === '' || cfg.espera_agrupar_seg == null ? 4 : Math.max(0, Number(cfg.espera_agrupar_seg))
  if (espera > 0) {
    await sleep(espera * 1000)
    const { data: ult } = await sb.from('mensajes').select('wa_id').eq('telefono', from).eq('rol', 'user').order('creado_en', { ascending: false }).limit(1).maybeSingle()
    if (ult && ult.wa_id !== msg.id) return
    await marcarLeido(msg.id)
  }

  const { data: hist } = await sb.from('mensajes').select('rol,contenido').eq('telefono', from).order('creado_en', { ascending: false }).limit(30)
  const history = compactar((hist ?? []).reverse())

  let prov: Provider
  try { prov = await construirProveedor(sb, cfg) }
  catch (e) {
    await registrarAlerta(sb, cfg, 'error', String(e))
    await sendText(from, 'Dame un momento, en seguida te ayudo 🙏'); return
  }
  const hoy = fechaBogota()
  const hora = new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit', hour12: true })
  const system = `${cfg.system_prompt}\n\n[Contexto del sistema] Hoy es ${diaSemana(hoy)} ${hoy}, son las ${hora} (hora de Colombia). ` +
    `Días de producción: ${cfg.dias_produccion}. Franjas de entrega: ${cfg.franjas_entrega}. Teléfono del chat: ${from}. ` +
    (nombreWA ? `Nombre en su WhatsApp: ${nombreWA}. ` : '') +
    (cfg.numero_atencion ? `Número de atención personalizada: ${cfg.numero_atencion}.` : 'No hay número de atención personalizada configurado: no des ninguno.') + resumenPedido
  const pa = await pedidoActivo(sb, from)
  const resumenPedido = pa
    ? `\n[Pedido activo de este cliente] #${pa.numero} · estado ${pa.estado} · ${pa.pagado ? 'PAGADO' : 'sin pagar'} · método: ${pa.metodo_pago} · total $${pa.total} · ` +
      `${pa.modalidad}${pa.direccion ? ' a ' + pa.direccion : ''} · entrega ${pa.fecha_entrega}${pa.franja_horaria ? ' ' + pa.franja_horaria : ''} · ` +
      `${(pa.pedido_items ?? []).map((i: any) => `${i.cantidad} ${i.productos?.nombre}`).join(', ')}. ` +
      `Este pedido YA está creado y su cupo reservado: NO vuelvas a consultar disponibilidad para él ni cambies su fecha. Para cambios usa modificar_pedido (solo si el ticket no se ha impreso).`
    : ''
  const ctx: Ctx = { sb, cfg, telefono: from, prov, comprobantePath: comprobantePath ?? conv?.ultimo_comprobante }

  let respuesta: string
  try { respuesta = await chat(prov, system, history, TOOLS, (n, a) => ejecutar(n, a, ctx)) }
  catch (e) { console.error('ia', e); await registrarAlerta(sb, cfg, 'error', String(e)); respuesta = 'Dame un momento, en seguida te ayudo 🙏' }
  if (respuesta) {
    await enviarNatural(from, respuesta, ctx, msg.id, cfg)
    // Seguimiento: si el bot dejó algo pendiente del cliente, se programa el recordatorio
    if (ctx.pendiente && !ctx.humano) {
      await sb.from('conversaciones').upsert({ telefono: from, esperando: ctx.pendiente, esperando_desde: new Date().toISOString(), seguimientos: 0 }, { onConflict: 'telefono' })
    }
  }
}

// Envía la respuesta en varios mensajes cortos con "escribiendo…" y pausas; [[FOTOS]] marca dónde van las fotos del catálogo.
async function enviarNatural(to: string, respuesta: string, ctx: Ctx, replyTo: string, cfg: Record<string, string>) {
  const simular = cfg.simular_escritura !== 'no'
  const msPorCaracter = Number(cfg.velocidad_escritura_ms) > 0 ? Number(cfg.velocidad_escritura_ms) : 35
  const partes = respuesta.replace(/\s*\[\[FOTOS\]\]\s*/g, '\n\n[[FOTOS]]\n\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  while (partes.length > 6) { const x = partes.pop()!; partes[partes.length - 1] += '\n' + x }
  let fotosEnviadas = false
  const guardar = (contenido: string, waId: string | null) => sb.from('mensajes').insert({ telefono: to, rol: 'assistant', contenido, wa_id: waId })
  const enviarFotos = async () => {
    if (fotosEnviadas || !ctx.fotos?.length) return
    fotosEnviadas = true
    for (const f of ctx.fotos) {
      const id = await sendImage(to, f.link, f.caption)
      await guardar(`[Foto del catálogo: ${f.caption}]`, id)
      if (simular) await sleep(700)
    }
  }
  for (const p of partes) {
    if (p === '[[FOTOS]]') { await enviarFotos(); continue }
    if (simular) { await marcarLeido(replyTo); await sleep(Math.min(Math.max(p.length * msPorCaracter, 1200), 5000)) }
    const id = await sendText(to, p)
    await guardar(p, id)
  }
  await enviarFotos()
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
  const items: { m: any; nombre?: string }[] = (body.entry ?? []).flatMap((e: any) => (e.changes ?? []).flatMap((c: any) =>
    (c.value?.messages ?? []).map((m: any) => ({ m, nombre: (c.value?.contacts ?? []).find((k: any) => k.wa_id === m.from)?.profile?.name }))))
  const work = Promise.all(items.map(({ m, nombre }) => manejar(m, nombre).catch((e) => console.error('manejar', e))))
  EdgeRuntime.waitUntil(work)
  return new Response('ok')
})
