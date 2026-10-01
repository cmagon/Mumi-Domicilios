import { createClient } from 'npm:@supabase/supabase-js@2'
import { chat, compactar, transcribir, type Provider } from './ai.ts'
import { direccionAprox } from './geo.ts'
import { registrarAlerta } from './alerts.ts'
import { memoriaCliente } from './memoria.ts'
import { humanoTardo } from './humano.ts'
import { apiKey, construirProveedor } from './config.ts'
import { digits, downloadMedia, marcarLeido, sendImage, sendText, verifySignature } from './wa.ts'
import { TOOLS, ejecutar, fechaBogota, diaSemana, pedidoActivo, cargarExcepciones, estadoEntrega, etiquetaEntrega, type Ctx } from './tools.ts'

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

async function cargarConfig() {
  const { data } = await sb.from('config').select('clave,valor')
  return Object.fromEntries((data ?? []).map((r) => [r.clave, r.valor])) as Record<string, string>
}

async function comandoAdmin(from: string, texto: string, cfg: Record<string, string>): Promise<boolean> {
  const t = texto.trim()
  // "Hoy: cacao 30, limón 20" = total que se hornea hoy (incluye lo reservado). "Fabricadas: cacao 40, limón 30" = suma al stock general.
  const modo = /^hoy\s*:/i.test(t) ? 'hoy' : /^(fabricad[oa]s?|congelad[oa]s?|stock)\s*:/i.test(t) ? 'lote' : null
  if (modo) {
    const { data: prods } = await sb.from('productos').select('id,nombre').eq('activo', true)
    const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const fecha = fechaBogota(); const ok: string[] = []; const fallo: string[] = []
    for (const par of t.replace(/^[^:]*:/, '').split(',')) {
      const m = par.trim().match(/^(.+?)\s+(-?\d+)$/)
      const p = m && (prods ?? []).find((x) => norm(x.nombre).includes(norm(m[1])) || norm(m[1]).includes(norm(x.nombre).split(' ')[0]))
      if (!m || !p) { fallo.push(par.trim()); continue }
      if (modo === 'hoy') await sb.from('produccion_dia').upsert({ fecha, producto_id: p.id, horneadas: Math.max(0, +m[2]), actualizado_en: new Date().toISOString() }, { onConflict: 'fecha,producto_id' })
      else await sb.from('stock_lotes').insert({ producto_id: p.id, cantidad: +m[2], nota: 'Registrado por WhatsApp', fecha })
      ok.push(`${p.nombre}: ${m[2]}`)
    }
    await sendText(from, `${modo === 'hoy' ? 'Horneado de hoy registrado' : 'Stock general actualizado (suma)'}:\n${ok.join('\n') || '—'}${fallo.length ? `\nNo entendí: ${fallo.join(', ')}` : ''}`)
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
  console.log('mensaje recibido', from, msg.type)
  const cfg = await cargarConfig()
  const admins = (cfg.admin_numeros ?? '').split(',').map(digits).filter(Boolean)
  const domi = digits(cfg.domiciliario_numero ?? '')

  // Respuestas de botones del domiciliario
  if (from === domi && (msg.type === 'interactive' || msg.type === 'button'))
    return botonDomiciliario(msg.interactive?.button_reply?.id ?? msg.button?.payload ?? '', from)

  // Dedupe por id de mensaje de WhatsApp
  const { error: dup } = await sb.from('mensajes').insert({ wa_id: msg.id, telefono: from, rol: 'user', contenido: '…' })
  if (dup) { console.log('mensaje duplicado, se ignora', msg.id); return }

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
      // ¿Tiene pedidos recientes sin pago confirmado? Se adjunta la imagen al pedido y se avisa al admin en el micrositio para que lo verifique
      const { data: pends } = await sb.from('pedidos').select('id,numero,total,metodo_pago').or(`chat_telefono.eq.${from},cliente_telefono.eq.${from}`)
        .eq('pagado', false).eq('archivado', false).not('estado', 'in', '(cancelado,entregado)')
        .gte('creado_en', new Date(Date.now() - 14 * 86400000).toISOString()).order('creado_en', { ascending: false })
      const sinPagar = (pends ?? []).filter((p: any) => !/efectivo/i.test(p.metodo_pago ?? ''))
      if (sinPagar.length) {
        const p = sinPagar[0] as any
        await sb.from('pedidos').update({ comprobante_url: comprobantePath }).eq('id', p.id)
        const aviso = { tipo: 'pago_revision', titulo: `Posible comprobante — pedido #${p.numero}`, pedido_id: p.id, telefono: from,
          detalle: `El cliente envió una imagen y el pedido tiene el pago pendiente ($${p.total} por ${p.metodo_pago ?? 'transferencia'}). Verifica el soporte y confirma el pago.${sinPagar.length > 1 ? ` También tiene pendientes: ${sinPagar.slice(1).map((x: any) => '#' + x.numero).join(', ')}.` : ''}` }
        const { error: ea } = await sb.from('notificaciones').insert({ ...aviso, media_path: comprobantePath })
        if (ea) await sb.from('notificaciones').insert(aviso) // por si la migración 0025 aún no se corrió
        texto += ` [Sistema: el cliente tiene el pedido #${p.numero} con el pago pendiente. La imagen ya se adjuntó al pedido y se avisó al equipo para que verifique el pago. Agradécele, dile que recibiste el comprobante y que el equipo lo verifica y le confirma. NO marques el pedido como pagado ni pidas más datos de pago.]`
      }
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
  await sb.from('mensajes').update({ contenido: texto, ...(comprobantePath ? { media_path: comprobantePath } : {}) }).eq('wa_id', msg.id)
  // El cliente respondió: se cancela cualquier seguimiento pendiente
  await sb.from('conversaciones').upsert({ telefono: from, esperando: null, esperando_desde: null, seguimientos: 0, ultimo_cliente_en: new Date().toISOString() }, { onConflict: 'telefono' })
  // El nombre del perfil va aparte: si la columna aún no existe, no afecta lo demás
  if (nombreWA) await sb.from('conversaciones').update({ nombre_wa: nombreWA }).eq('telefono', from)

  if (admins.includes(from) && (await comandoAdmin(from, texto, cfg))) return
  if (from === domi && (await comandoDomiciliario(from, texto))) return

  const { data: conv } = await sb.from('conversaciones').select('humano,humano_desde,ultimo_comprobante').eq('telefono', from).maybeSingle()
  let retomado = false
  if (conv?.humano) {
    // El bot calla mientras atiende una persona. Vuelve si ella tarda más de N min en responder (config minutos_humano_sin_responder)
    // o pasadas "horas_humano" h (config)
    const horas = Number(cfg.horas_humano) > 0 ? Number(cfg.horas_humano) : 12
    const desde = conv.humano_desde ? new Date(conv.humano_desde).getTime() : 0
    const tardo = await humanoTardo(sb, cfg, from, conv.humano_desde)
    if (!tardo && Date.now() - desde < horas * 3600 * 1000) { console.log('chat en atención humana; el bot calla', from); return }
    retomado = tardo
    await sb.from('conversaciones').update({ humano: false, humano_desde: null }).eq('telefono', from)
  }
  await responder({ from, msgId: msg.id, texto, cfg, ultimoComprobante: comprobantePath ?? conv?.ultimo_comprobante, nombreWA, retomado, agrupar: true })
}

// Genera y envía la respuesta del bot. `agrupar`: espera por si el cliente sigue escribiendo (ráfagas).
async function responder(p: { from: string; msgId: string; texto: string; cfg: Record<string, string>; ultimoComprobante?: string | null; nombreWA?: string; retomado?: boolean; agrupar: boolean }) {
  const { from, texto, cfg, nombreWA } = p
  const msg = { id: p.msgId }
  const comprobantePath = p.ultimoComprobante
  const conv = { ultimo_comprobante: p.ultimoComprobante }

  // Agrupa ráfagas: si el cliente sigue escribiendo, solo responde la invocación del último mensaje, con todo el contexto
  const hayNuevo = async () => {
    const { data: u } = await sb.from('mensajes').select('wa_id,contenido,creado_en').eq('telefono', from).eq('rol', 'user').order('creado_en', { ascending: false }).limit(1).maybeSingle()
    if (!u || u.wa_id === msg.id) return false
    return u.contenido !== '…' || Date.now() - new Date(u.creado_en).getTime() < 90000 // marcadores viejos sin procesar no cuentan
  }
  const espera = cfg.espera_agrupar_seg === '' || cfg.espera_agrupar_seg == null ? 5 : Math.max(0, Number(cfg.espera_agrupar_seg))
  if (p.agrupar && espera > 0) {
    await sleep(espera * 1000)
    if (await hayNuevo()) { console.log('llegó otro mensaje del cliente; responde el último', from); return }
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
  const memoria = await memoriaCliente(sb, prov, from).catch((e) => { console.error('memoria', e); return '' })
  const hoy = fechaBogota()
  const hora = new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit', hour12: true })
  const pa = await pedidoActivo(sb, from)
  const resumenPedido = pa
    ? `\n[Pedido activo de este cliente] #${pa.numero} · estado ${pa.estado} · ${pa.pagado ? 'PAGADO' : 'sin pagar'} · método: ${pa.metodo_pago} · total $${pa.total} · ` +
      `${pa.modalidad}${pa.direccion ? ' a ' + pa.direccion : ''} · entrega ${pa.fecha_entrega}${pa.franja_horaria ? ' ' + pa.franja_horaria : ''} · NOTA VIGENTE DEL TICKET: ${pa.nota ? '«' + pa.nota + '»' : '(ninguna)'} · ` +
      `${(pa.pedido_items ?? []).map((i: any) => `${i.cantidad} ${i.productos?.nombre}`).join(', ')}. ` +
      `Este pedido YA está creado y su cupo reservado: NO vuelvas a consultar disponibilidad para él ni cambies su fecha. Para cambios usa modificar_pedido (solo si el ticket no se ha impreso).`
    : ''
  const excep = await cargarExcepciones(sb)
  const calEspecial = excep.size ? ' Calendario especial (próximas fechas): ' + [...excep.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 12)
    .map(([f, e]) => `${f} ${e.tipo === 'cerrado' ? 'SIN producción ni entregas' + (e.nota ? ` (${e.nota})` : '') : 'producción extra' + (e.nota ? ` (${e.nota})` : '')}`).join('; ') + '.' : ''
  const ent = await estadoEntrega(sb, cfg, excep)
  const entregaAhora = ent.mismoDia
    ? `[Entrega ahora] HOY sí se toman pedidos nuevos (entregas${ent.cierre ? ` hasta las ${ent.cierre.texto}` : ''}); los sabores y cantidades exactas salen de consultar_stock.`
    : `[Entrega ahora] HOY NO se toman pedidos nuevos (${ent.hoySeAcaboTodo ? 'ya se acabaron las galletas de hoy' : ent.motivoNoHoy}). La próxima fecha de entrega es ${ent.proxima ? etiquetaEntrega(ent.proxima, ent.hoy, ent.cierre) : 'por definir'} (${ent.proxima ?? ''}). NUNCA digas que hay galletas "para hoy"; no cambies esta versión durante la conversación.`
  const { data: aprend } = await sb.from('bot_aprendizajes').select('regla').eq('estado', 'activa').order('creado_en').limit(30)
  const aprendizajes = (aprend ?? []).length ? `\n\n[Aprendizajes aprobados por el equipo — aplícalos siempre]\n${(aprend ?? []).map((x: any) => '- ' + x.regla).join('\n')}` : ''
  const system = `${cfg.system_prompt}${aprendizajes}\n\n[Contexto del sistema] ${entregaAhora}\nHoy es ${diaSemana(hoy)} ${hoy}, son las ${hora} (hora de Colombia). ` +
    `Días de producción: ${cfg.dias_produccion}.${calEspecial} Franjas de entrega: ${cfg.franjas_entrega}. Teléfono del chat: ${from}. ` +
    (nombreWA ? `Nombre en su WhatsApp: ${nombreWA}. ` : '') +
    (p.retomado ? 'NOTA: una persona del equipo estaba atendiendo este chat pero no alcanzó a responder a tiempo; retoma tú la conversación con naturalidad (puedes pedir una breve disculpa por la espera) sin mencionar sistemas internos. ' : '') +
    (cfg.numero_atencion ? `Número de atención personalizada: ${cfg.numero_atencion}.` : 'No hay número de atención personalizada configurado: no des ninguno.') + resumenPedido + (memoria ? `\n\n${memoria}` : '')
  const ctx: Ctx = { sb, cfg, telefono: from, prov, comprobantePath: comprobantePath ?? conv?.ultimo_comprobante }

  const FALLBACK = 'Dame un momento, en seguida te ayudo 🙏'
  let respuesta = ''
  try {
    respuesta = (await chat(prov, system, history, TOOLS, (n, a) => ejecutar(n, a, ctx))).trim()
    if (!respuesta.replace(/\[\[FOTOS\]\]/g, '').trim() && !ctx.fotos?.length && !ctx.humano) {
      // El modelo a veces devuelve una respuesta vacía: se reintenta una vez pidiéndole que responda al cliente
      console.warn('respuesta vacía del modelo; reintentando', from)
      respuesta = (await chat(prov, system, [...history, { role: 'assistant', content: '…' }, { role: 'user', content: '[Sistema — no lo escribió el cliente] Responde ahora al último mensaje del cliente con un mensaje corto y natural.' }],
        TOOLS, (n, a) => ejecutar(n, a, ctx))).trim()
    }
    if (!respuesta.replace(/\[\[FOTOS\]\]/g, '').trim() && !ctx.humano) {
      await registrarAlerta(sb, cfg, 'error', 'El modelo devolvió una respuesta vacía (se envió un mensaje de espera al cliente)')
      respuesta = FALLBACK
    }
  } catch (e) { console.error('ia', e); await registrarAlerta(sb, cfg, 'error', String(e)); respuesta = FALLBACK }
  console.log('respuesta', from, JSON.stringify(respuesta.slice(0, 120)))
  if (respuesta) {
    // No repetir lo que ya se le dijo al cliente, salvo que vuelva a preguntar
    const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim()
    const dicho = new Set(history.filter((h) => h.role === 'assistant').slice(-6).flatMap((h) => h.content.split('\n').map(norm)).filter(Boolean))
    const pregunto = /[?¿]/.test(texto) || /^(cu[aá]l|cu[aá]les|qu[eé]|c[oó]mo|cu[aá]nt|d[oó]nde|hay|tiene|tienen)\b/i.test(texto.trim())
    const partes = respuesta.split(/\n{2,}/)
    const nuevas = partes.filter((p) => p.trim() === '[[FOTOS]]' || !p.split('\n').map(norm).filter(Boolean).every((l) => dicho.has(l)))
    if (!pregunto && nuevas.some((p) => p.trim() !== '[[FOTOS]]') && nuevas.length < partes.length) { console.log('se omiten mensajes repetidos', from); respuesta = nuevas.join('\n\n') }
    // Si el cliente escribió mientras yo preparaba la respuesta, la descarto: la invocación del último mensaje responde una sola vez con todo
    if (await hayNuevo()) { console.log('llegó otro mensaje mientras respondía; se descarta', from); return }
    await enviarNatural(from, respuesta, ctx, msg.id, cfg, hayNuevo)
    // Seguimiento: si el bot dejó algo pendiente del cliente, se programa el recordatorio
    // Si quedó una pregunta abierta y la venta no está cerrada, también se programa retomar la conversación
    const cerrado = ctx.pedidoCreado ? true : pa ? (pa.pagado || /efectivo/i.test(pa.metodo_pago ?? '')) : false
    const pendienteFinal = ctx.pendiente ?? (!cerrado && respuesta.includes('?') ? 'que el cliente retome su compra donde quedó' : null)
    if (pendienteFinal && !ctx.humano) {
      await sb.from('conversaciones').upsert({ telefono: from, esperando: pendienteFinal, esperando_desde: new Date().toISOString(), seguimientos: 0 }, { onConflict: 'telefono' })
    }
  }
}

// Envía la respuesta en varios mensajes cortos con "escribiendo…" y pausas; [[FOTOS]] marca dónde van las fotos del catálogo.
async function enviarNatural(to: string, respuesta: string, ctx: Ctx, replyTo: string, cfg: Record<string, string>, hayNuevo: () => Promise<boolean>) {
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
    if (await hayNuevo()) { console.log('el cliente escribió mientras enviaba; se detiene el resto', to); return }
    const id = await sendText(to, p)
    await guardar(p, id)
  }
  await enviarFotos()
}

// Retoma un chat atendido por una persona que tardó en responder (lo invoca el cron "seguimientos")
async function retomar(telefono: string) {
  const cfg = await cargarConfig()
  const { data: conv } = await sb.from('conversaciones').select('humano,humano_desde,ultimo_comprobante,nombre_wa').eq('telefono', telefono).maybeSingle()
  if (!conv?.humano || !(await humanoTardo(sb, cfg, telefono, conv.humano_desde))) return
  const { data: u } = await sb.from('mensajes').select('wa_id,contenido').eq('telefono', telefono).eq('rol', 'user').order('creado_en', { ascending: false }).limit(1).maybeSingle()
  if (!u) return
  await sb.from('conversaciones').update({ humano: false, humano_desde: null }).eq('telefono', telefono)
  console.log('la persona tardó en responder; el bot retoma', telefono)
  await responder({ from: telefono, msgId: u.wa_id, texto: String(u.contenido ?? ''), cfg, ultimoComprobante: conv.ultimo_comprobante, nombreWA: conv.nombre_wa ?? undefined, retomado: true, agrupar: false })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  if (req.method === 'GET') { // verificación del webhook de Meta
    if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === Deno.env.get('WHATSAPP_VERIFY_TOKEN'))
      return new Response(url.searchParams.get('hub.challenge'))
    return new Response('forbidden', { status: 403 })
  }
  const secretoCron = req.headers.get('x-cron-secret')
  if (secretoCron) { // llamada interna del cron (seguimientos)
    if (secretoCron !== Deno.env.get('NOTIFY_WEBHOOK_SECRET')) return new Response('forbidden', { status: 403 })
    const { reanudar } = await req.json().catch(() => ({}))
    if (reanudar) EdgeRuntime.waitUntil(retomar(String(reanudar)).catch(async (e) => { console.error('retomar', e); await registrarAlerta(sb, await cargarConfig(), 'error', `Fallo retomando un chat: ${e}`) }))
    return new Response('ok')
  }
  const raw = await req.text()
  if (!(await verifySignature(raw, req.headers.get('x-hub-signature-256')))) return new Response('bad signature', { status: 401 })
  const body = JSON.parse(raw)
  const items: { m: any; nombre?: string }[] = (body.entry ?? []).flatMap((e: any) => (e.changes ?? []).flatMap((c: any) =>
    (c.value?.messages ?? []).map((m: any) => ({ m, nombre: (c.value?.contacts ?? []).find((k: any) => k.wa_id === m.from)?.profile?.name }))))
  const work = Promise.all(items.map(({ m, nombre }) => manejar(m, nombre).catch(async (e) => {
    console.error('manejar', e)
    try {
      const { data: c } = await sb.from('config').select('clave,valor')
      await registrarAlerta(sb, Object.fromEntries((c ?? []).map((r) => [r.clave, r.valor])), 'error', `Fallo procesando un mensaje: ${e}`)
      if (m?.from) await sendText(m.from, 'Dame un momento, en seguida te ayudo 🙏')
    } catch (e2) { console.error('manejar/aviso', e2) }
  })))
  EdgeRuntime.waitUntil(work)
  return new Response('ok')
})
