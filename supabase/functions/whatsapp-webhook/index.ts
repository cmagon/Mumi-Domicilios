import { createClient } from 'npm:@supabase/supabase-js@2'
import { chat, compactar, transcribir, type Provider } from './ai.ts'
import { direccionAprox } from './geo.ts'
import { registrarAlerta } from './alerts.ts'
import { memoriaCliente } from './memoria.ts'
import { humanoTardo } from './humano.ts'
import { sinNumeroPedido, franjasHabladas } from './texto.ts'
import { pushAdmin } from './push.ts'
import { comandoAviso, contextoAvisos } from './avisos.ts'
import { mediaAdmin } from './adminmedia.ts'
import { asistenteAdmin } from './adminpedido.ts'
import { conversarEquipo } from './equipo.ts'
import { avisoAdminWA } from './adminresumen.ts'
import { apiKey, construirProveedor } from './config.ts'
import { digits, downloadMedia, marcarLeido, sendImage, sendLocation, sendText, sendVideo, verifySignature } from './wa.ts'
import { combosVigentes, TOOLS, ejecutar, fechaBogota, diaSemana, pedidoActivo, pedidosActivos, cargarExcepciones, estadoEntrega, etiquetaEntrega, ventanaEntregas, type Ctx } from './tools.ts'

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

// Equipo (administradores, socios y domiciliario): jamás se trata como cliente. Texto y notas de voz van a su asistente interno; lo demás se ignora con cortesía.
async function manejarEquipo(msg: any, from: string, cfg: Record<string, string>, esAdmin: boolean) {
  let texto = ''
  if (msg.type === 'text') texto = msg.text.body
  else if (msg.type === 'audio') {
    const motor = cfg.motor_audio === 'openai' ? 'openai' : 'gemini'
    const key = await apiKey(sb, cfg, motor)
    if (!key) { await sendText(from, 'No puedo escuchar audios porque falta la API key de transcripción. ¿Me lo escribes? 🙏'); return }
    try {
      const { bytes, mime } = await downloadMedia(msg.audio.id)
      texto = (await transcribir(motor, key, bytes, mime, cfg.modelo_ia && cfg.proveedor_ia === 'gemini' ? cfg.modelo_ia : undefined)).trim()
    } catch (e) { console.error('audio del equipo', e); await sendText(from, 'No pude escuchar el audio, ¿me lo escribes? 🙏'); return }
    if (!texto || /^\W*\[?inaudible\]?\W*$/i.test(texto)) { await sendText(from, 'No alcancé a escuchar bien el audio 🙏 ¿me lo repites?'); return }
  } else if (msg.type === 'location') texto = `[Ubicación compartida: lat ${msg.location?.latitude}, lng ${msg.location?.longitude}${msg.location?.name ? ', ' + msg.location.name : ''}]`
  else if (['image', 'video', 'document'].includes(msg.type)) {
    await sendText(from, esAdmin ? 'Recibí el archivo 📎 pero no es una foto para el catálogo. Para subir una foto o video escribe en el pie: "foto: Cacao" (producto existente) o "nuevo: Nombre, precio, descripción".' : 'Recibí tu archivo 📎. Si necesitas algo, escríbeme.')
    return
  } else return // stickers, reacciones, etc.: sin respuesta
  await sb.from('mensajes').update({ contenido: texto }).eq('wa_id', msg.id)
  if (esAdmin) { if (!(await comandoAdmin(from, texto, cfg)) && !(await comandoAviso(sb, cfg, from, texto))) await asistenteAdmin(sb, cfg, from, texto); return }
  if (await comandoDomiciliario(from, texto)) return
  await conversarEquipo(sb, cfg, from, texto, 'domiciliario')
}

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

  // La palomita azul NO se marca al recibir: solo la pone el bot cuando va a responder (abajo), o la persona al abrir el chat en el micrositio.
  // Así, si una persona atiende, no parece que leyó el mensaje y lo ignoró. Los números del equipo sí se marcan (los atiende el sistema).
  if (admins.includes(from) || from === domi) await marcarLeido(msg.id)

  // Un administrador envía una foto/video con "foto: <sabor>" o "nuevo: Nombre, precio, descripción": va al catálogo
  if (admins.includes(from) && ['image', 'video', 'document'].includes(msg.type) && (await mediaAdmin(sb, msg, from))) {
    await sb.from('mensajes').update({ contenido: '[El administrador envió un archivo al catálogo]' }).eq('wa_id', msg.id)
    return
  }

  // Equipo: nunca entra al flujo de clientes (ni comprobantes, ni seguimientos, ni notificaciones)
  if (admins.includes(from) || from === domi) { await manejarEquipo(msg, from, cfg, admins.includes(from)); return }

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
        if (/^\W*\[?inaudible\]?\W*$/i.test(texto.trim())) { await sendText(from, 'No alcancé a escuchar bien tu audio 🙏 ¿me lo repites o me lo escribes?'); return }
        if (/inaudible/i.test(texto)) texto = `[Nota de voz con partes que no se entendieron; no supongas lo que falta: pregúntaselo] ${texto}`
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
        await avisoAdminWA(sb, aviso.titulo, aviso.detalle, from)
        texto += ` [Sistema: el cliente tiene el pedido #${p.numero} con el pago pendiente. La imagen ya se adjuntó al pedido y se avisó al equipo para que verifique el pago. Agradécele, dile que recibiste el comprobante y que el equipo lo verifica y le confirma. NO marques el pedido como pagado ni pidas más datos de pago.]`
      }
    } else if (msg.type === 'location') {
      const l = msg.location ?? {}
      const aprox = await direccionAprox(Number(l.latitude), Number(l.longitude))
      await sb.from('conversaciones').upsert({ telefono: from, ultima_lat: l.latitude, ultima_lng: l.longitude,
        ultima_direccion_aprox: [l.name, l.address].filter(Boolean).join(', ') || aprox }, { onConflict: 'telefono' })
      texto = `[El cliente compartió su ubicación con el pin. ${[l.name, l.address].filter(Boolean).length ? 'Lugar: ' + [l.name, l.address].filter(Boolean).join(', ') + '. ' : ''}` +
        `Dirección aproximada detectada: ${aprox ?? 'no disponible'} (lat ${l.latitude}, lng ${l.longitude}). Es solo aproximada: dile en qué zona/barrio lo ubicas y pídele una seña (casa, conjunto, apto, punto de referencia). Al crear el pedido usa ubicacion_compartida=true.]`
    } else if (msg.type === 'interactive' || msg.type === 'button') {
      // El cliente tocó un botón (p. ej. de una promoción): se toma como si hubiera escrito el texto del botón
      const br = msg.interactive?.button_reply ?? msg.interactive?.list_reply
      const titulo = String(br?.title ?? msg.button?.text ?? '').trim()
      const bid = String(br?.id ?? msg.button?.payload ?? '')
      texto = titulo || '[El cliente tocó un botón]'
      const m = bid.match(/^camp:([0-9a-f-]{36}):(\d)$/)
      if (m) {
        texto = `[El cliente tocó el botón «${titulo}» de la promoción que le enviamos] ${titulo}`
        await sb.from('campana_envios').update({ boton_tocado: Number(m[2]), respondio_en: new Date().toISOString() }).eq('campana_id', m[1]).eq('telefono', from)
      }
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
  await pushAdmin(sb, `💬 ${nombreWA || from}`, texto.replace(/^\[[^\]]*\]\s*/, ''), { tag: `chat-${from}`, url: '/chats' }) // notificación al celular/PC del admin (segundo plano)
  // El cliente respondió: se cancela cualquier seguimiento pendiente
  await sb.from('conversaciones').upsert({ telefono: from, esperando: null, esperando_desde: null, seguimientos: 0, ultimo_cliente_en: new Date().toISOString() }, { onConflict: 'telefono' })
  // El nombre del perfil va aparte: si la columna aún no existe, no afecta lo demás
  if (nombreWA) await sb.from('conversaciones').update({ nombre_wa: nombreWA }).eq('telefono', from)


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
// Combos y promociones vigentes: el bot las menciona cuando preguntan por ofertas y, si hay, también en el primer mensaje (breve, tras saludar)
async function contextoOfertas(): Promise<string> {
  const vig = await combosVigentes(sb)
  if (!vig.length) return ''
  const normal = (c: any) => (c.combo_items ?? []).reduce((t: number, i: any) => t + i.cantidad * (i.productos?.precio ?? 0), 0)
  return `\n\n[Ofertas vigentes] ${vig.map((c: any) => `• ${c.nombre} — $${c.precio}: ${(c.combo_items ?? []).map((i: any) => `${i.cantidad} ${i.productos?.nombre}`).join(' + ')}${normal(c) > c.precio ? ` (normal $${normal(c)})` : ''}${c.hasta ? ` (hasta el ${c.hasta})` : ''}${c.descripcion ? ` — ${c.descripcion}` : ''}`).join(' ')} ` +
    `Cuando el cliente pregunte por ofertas, promociones, combos o descuentos, cuéntaselas (usa consultar_ofertas para el detalle). Además, en el PRIMER mensaje de la conversación menciónalas brevemente después de saludar aunque no las pida (una sola vez; si no le interesan, no insistas). Para venderlas usa crear_pedido con combos.`
}

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

  const { data: hist } = await sb.from('mensajes').select('rol,contenido,creado_en').eq('telefono', from).order('creado_en', { ascending: false }).limit(30)
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
  const activos = await pedidosActivos(sb, from)
  const pa = activos[0]
  const descPedido = (x: any) => `#${x.numero} · estado ${x.estado} · ${x.pagado ? 'PAGADO' : 'sin pagar'} · método: ${x.metodo_pago} · total $${x.total} · ` +
    `${x.modalidad}${x.direccion ? ' a ' + x.direccion : ''} · entrega ${x.fecha_entrega}${x.franja_horaria ? ' ' + x.franja_horaria : ''} · NOTA VIGENTE DEL TICKET: ${x.nota ? '«' + x.nota + '»' : '(ninguna)'} · ` +
    `${(x.pedido_items ?? []).map((i: any) => `${i.cantidad} ${i.productos?.nombre}`).join(', ')}${x.cancelacion_solicitada ? ' · CANCELACIÓN YA SOLICITADA (en espera del equipo)' : ''}`
  const resumenPedido = activos.length
    ? `\n[${activos.length > 1 ? `Pedidos activos de este cliente (${activos.length}; cada uno se maneja por separado y las herramientas piden pedido_numero)` : 'Pedido activo de este cliente'}]\n${activos.map(descPedido).join('\n')}\n` +
      `Estos pedidos YA están creados y su cupo reservado: NO vuelvas a consultar disponibilidad para ellos ni cambies su fecha. Para cambios usa modificar_pedido (solo si el ticket no se ha impreso); para cancelar usa solicitar_cancelacion. Un pedido NUEVO (otra dirección u otra fecha) se crea con crear_pedido sin tocar los existentes.`
    : ''
  const excep = await cargarExcepciones(sb)
  const calEspecial = excep.size ? ' Calendario especial (próximas fechas): ' + [...excep.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 12)
    .map(([f, e]) => `${f} ${e.tipo === 'cerrado' ? 'SIN producción ni entregas' + (e.nota ? ` (${e.nota})` : '') : 'producción extra' + (e.nota ? ` (${e.nota})` : '')}`).join('; ') + '.' : ''
  // Inicio de la conversación en curso (mensajes seguidos sin pausas de más de 2 h)
  let sesionInicio: number | undefined
  { let prev = Date.now()
    const cron = hist ?? [] // ya en orden cronológico
    for (let i = cron.length - 1; i >= 0; i--) { const t = new Date((cron[i] as any).creado_en ?? 0).getTime(); if (!t || prev - t > 2 * 3600 * 1000) break; sesionInicio = t; prev = t } }
  const ent = await estadoEntrega(sb, cfg, excep, sesionInicio)
  const entregaAhora = ent.mismoDia
    ? `[Entrega ahora] HOY sí se toman pedidos nuevos (${ent.cierre ? ventanaEntregas(ent.cierre) + '; di siempre desde qué hora y hasta qué hora son las entregas de hoy' : 'entregas'}); los sabores y cantidades exactas salen de consultar_stock.${ent.porConfirmar ? ' Hoy hay producción: aún no se confirman las cantidades exactas, así que ofrécele los sabores de hoy como reserva (queda confirmada al hornear) sin hablar de registros ni sistemas internos.' : ''} Si antes en esta conversación ofreciste otra fecha porque hoy no había, ESO CAMBIÓ: ahora hay para hoy; ofrécele primero hoy (y avísale con naturalidad que acaba de haber disponibilidad) y no sigas con la fecha anterior sin preguntarle. Vuelve a llamar a consultar_stock antes de confirmar.`
    : `[Entrega ahora] HOY NO se toman pedidos nuevos (${ent.hoySeAcaboTodo ? 'ya se acabaron las galletas de hoy' : ent.motivoNoHoy}). La próxima fecha de entrega es ${ent.proxima ? etiquetaEntrega(ent.proxima, ent.hoy, ent.cierre) : 'por definir'} (${ent.proxima ?? ''}). NUNCA digas que hay galletas "para hoy" mientras este estado siga así. NUNCA le expliques al cliente el motivo interno (horneado sin registrar, límites, sistema); solo di que por ahora no hay producción confirmada para hoy (o que ya cerraron los pedidos de hoy) y ofrece agendar para la próxima fecha. Esta información se actualiza en cada mensaje: ignora lo que dijiste antes si contradice este estado.`
  let { data: aprendTodas, error: errA } = await sb.from('bot_aprendizajes').select('regla,vigente_hasta').eq('estado', 'activa').order('creado_en').limit(40)
  if (errA) ({ data: aprendTodas } = await sb.from('bot_aprendizajes').select('regla').eq('estado', 'activa').order('creado_en').limit(40)) // migración 0035 pendiente
  const aprend = (aprendTodas ?? []).filter((x: any) => !x.vigente_hasta || x.vigente_hasta >= hoy) // las que vencieron dejan de aplicarse
  const aprendizajes = (aprend ?? []).length ? `\n\n[Aprendizajes aprobados por el equipo — aplícalos siempre con CUALQUIER cliente (son globales, no de un cliente); si implican cifras, no las des: avisa al equipo]\n${(aprend ?? []).map((x: any) => '- ' + x.regla).join('\n')}` : ''
  const veracidad = '\n\n[Veracidad] No afirmes ingredientes, alérgenos, composición, procesos ni promesas que no estén escritos en el catálogo (descripcion/detalles) o en tus instrucciones; si preguntan "¿lleva X?" y no consta, di que lo confirma una persona del equipo (avisar_equipo) — NUNCA contestes "sí" por complacencia ni repitas como cierto algo que el cliente sugiere. Los audios se transcriben automáticamente y pueden tener errores: si algo suena raro o fuera de contexto, pídele que lo confirme en lugar de asumirlo.'
  const system = `${cfg.system_prompt}${aprendizajes}${veracidad}\n\n[Contexto del sistema] ${entregaAhora}\nHoy es ${diaSemana(hoy)} ${hoy}, son las ${hora} (hora de Colombia). ` +
    `Días de producción: ${cfg.dias_produccion}.${calEspecial}${(cfg.barrios_sin_domicilio ?? '').trim() ? ` NO hacemos domicilio en: ${cfg.barrios_sin_domicilio}.` : ''} Franjas de entrega: ${franjasHabladas(cfg.franjas_entrega ?? '')}. Teléfono del chat: ${from}. ` +
    (nombreWA ? `Nombre en su WhatsApp: ${nombreWA}. ` : '') +
    (p.retomado ? 'NOTA: una persona del equipo estaba atendiendo este chat pero no alcanzó a responder a tiempo; retoma tú la conversación con naturalidad (puedes pedir una breve disculpa por la espera) sin mencionar sistemas internos. ' : '') +
    (cfg.numero_atencion ? `Número de atención personalizada: ${cfg.numero_atencion}.` : 'No hay número de atención personalizada configurado: no des ninguno.') + resumenPedido + (memoria ? `\n\n${memoria}` : '') + (await contextoAvisos(sb).catch(() => '')) + (await contextoOfertas().catch(() => ''))
  const ctx: Ctx = { sb, cfg, telefono: from, prov, sesionInicio, comprobantePath: comprobantePath ?? conv?.ultimo_comprobante }

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
  // Guarda: el bot dijo que el pedido quedó reservado/tomado pero no existe ningún pedido → se corrige antes de enviar
  const dijoReservado = (t: string) => /(te (lo |la |los |las )?(dej[eé]|separ[eé]|reserv[eé]|agend[eé])|qued[oó] (reservad|separad|agendad|pedido|tu pedido)|ya (est[aá]|qued[oó]) (reservad|separad|agendad|tomad|listo)|te (lo|la|los|las) dejo (reservad|separad|listo|agendad))/i.test(t)
  if (respuesta && respuesta !== FALLBACK && !ctx.pedidoCreado && activos.length === 0 && dijoReservado(respuesta)) {
    console.warn('el bot dijo que reservó sin crear pedido; se corrige', from, ctx.errorPedido ?? '')
    try {
      const fix = (await chat(prov, system, [...history, { role: 'assistant', content: respuesta }, { role: 'user', content: `[Sistema — no lo escribió el cliente] Tu mensaje anterior dice que el pedido quedó reservado, pero NO existe ningún pedido creado${ctx.errorPedido ? ` (crear_pedido respondió: ${ctx.errorPedido})` : ' (no llamaste a crear_pedido)'}. Si ya tienes todos los datos, llama a crear_pedido ahora (transferencia sin comprobante = se reserva con el pago pendiente; sin dirección = direccion_pendiente=true). Si falta un dato, pídelo. Escribe el mensaje definitivo para el cliente, sin mencionar este aviso.` }],
        TOOLS, (n, a) => ejecutar(n, a, ctx))).trim()
      if (fix) respuesta = fix
    } catch (e) { console.error('guarda reserva', e) }
    if (!ctx.pedidoCreado && dijoReservado(respuesta)) await sb.from('notificaciones').insert({ tipo: 'atencion', titulo: 'El bot dijo que reservó, pero no hay pedido', telefono: from,
      detalle: `Revisa el chat y toma el pedido (🛒).${ctx.errorPedido ? ' Error al crearlo: ' + ctx.errorPedido : ''}` })
  }
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
    // Solo se considera cerrada la venta si este turno creó el pedido (un pedido viejo, pagado o en efectivo, no debe impedir retomar una conversación nueva)
    const cerrado = !!ctx.pedidoCreado
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
      const id = f.tipo === 'video' ? await sendVideo(to, f.link, f.caption) : await sendImage(to, f.link, f.caption)
      await guardar(`[${f.tipo === 'video' ? 'Video' : 'Foto'} del catálogo: ${f.caption}]`, id)
      if (simular) await sleep(700)
    }
  }
  for (let p of partes) {
    if (p === '[[FOTOS]]') { await enviarFotos(); continue }
    if (simular) { await marcarLeido(replyTo); await sleep(Math.min(Math.max(p.length * msPorCaracter, 1200), 5000)) }
    if (await hayNuevo()) { console.log('el cliente escribió mientras enviaba; se detiene el resto', to); return }
    p = sinNumeroPedido(p)
    const id = await sendText(to, p)
    await guardar(p, id)
  }
  await enviarFotos()
  if (ctx.enviarLocal) { // pin del local (o enlace al mapa si no hay coordenadas)
    const lat = Number(cfg.local_lat), lng = Number(cfg.local_lng)
    const dir = cfg.local_direccion || 'Cra 19d No. 21-35, Barrio La Granja'
    const id = lat && lng ? await sendLocation(to, lat, lng, cfg.local_nombre || 'Mumi', dir) : await sendText(to, `📍 ${dir}\nhttps://maps.google.com/?q=${encodeURIComponent(dir + ' San José del Guaviare')}`)
    await guardar(`[Ubicación del local: ${dir}]`, id)
  }
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
