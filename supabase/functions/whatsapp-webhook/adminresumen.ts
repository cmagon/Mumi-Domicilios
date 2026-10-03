// Funciones del asistente del administrador: reportes, cancelación masiva con aviso a los clientes y resúmenes automáticos
// (a las 6 p. m. y antes de que se cierre la ventana de 24 h de WhatsApp, para mantener la conversación con el admin siempre abierta).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { sendText } from './wa.ts'
import { notificarAdmins } from './notifequipo.ts'
import { fechaBogota } from './tools.ts'

const fmt$ = (n: number) => '$' + Number(n).toLocaleString('es-CO')
const dia = (f: string) => new Date(f + 'T12:00:00Z').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const suma = (f: string, n: number) => new Date(new Date(f + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10)
const etiqueta = (f: string, hoy: string) => f === hoy ? 'hoy' : f === suma(hoy, 1) ? 'mañana' : f === suma(hoy, -1) ? 'ayer' : dia(f)

// deno-lint-ignore no-explicit-any
type Ped = any
const activos = (p: Ped) => p.estado !== 'cancelado'

async function pedidosDe(sb: SupabaseClient, fecha: string): Promise<Ped[]> {
  const { data } = await sb.from('pedidos').select('id,numero,cliente_nombre,cliente_telefono,chat_telefono,estado,pagado,total,metodo_pago,modalidad,fecha_entrega,pedido_items(cantidad,productos(nombre))')
    .eq('fecha_entrega', fecha).order('creado_en')
  return data ?? []
}

// Reporte de un día: pedidos, clientes, ventas, galletas por sabor, pagos pendientes y chats
export async function reporteDia(sb: SupabaseClient, fecha: string): Promise<string> {
  const hoy = fechaBogota()
  const todos = await pedidosDe(sb, fecha)
  const ped = todos.filter(activos)
  const cancelados = todos.length - ped.length
  const clientes = new Set(ped.map((p) => p.chat_telefono || p.cliente_telefono || p.cliente_nombre)).size
  const total = ped.reduce((t, p) => t + Number(p.total), 0)
  const porSabor = new Map<string, number>()
  for (const p of ped) for (const i of p.pedido_items ?? []) porSabor.set(i.productos?.nombre ?? '?', (porSabor.get(i.productos?.nombre ?? '?') ?? 0) + i.cantidad)
  const sinPagar = ped.filter((p) => !p.pagado && !/efectivo/i.test(p.metodo_pago ?? ''))
  const domi = ped.filter((p) => p.modalidad === 'domicilio').length
  let txt = `📊 Pedidos para ${etiqueta(fecha, hoy)} (${dia(fecha)})\n`
  if (!ped.length) txt += '• Aún no hay pedidos para esa fecha.\n'
  else {
    txt += `• Pedidos: ${ped.length} (${domi} a domicilio, ${ped.length - domi} para recoger)\n• Clientes: ${clientes}\n• Total: ${fmt$(total)}\n`
    txt += `• Galletas: ${[...porSabor.entries()].map(([s, c]) => `${c} ${s}`).join(', ') || '—'} (${[...porSabor.values()].reduce((a, b) => a + b, 0)} en total)\n`
    if (sinPagar.length) txt += `• Con pago por transferencia pendiente: ${sinPagar.length}\n`
  }
  if (cancelados) txt += `• Cancelados: ${cancelados}\n`
  // Actividad de chats del día (hora de Colombia)
  const desde = new Date(`${fecha}T00:00:00-05:00`).toISOString(), hasta = new Date(`${suma(fecha, 1)}T00:00:00-05:00`).toISOString()
  const { data: ch } = await sb.from('mensajes').select('telefono').eq('rol', 'user').gte('creado_en', desde).lt('creado_en', hasta).limit(2000)
  if (ch?.length) txt += `• Clientes que escribieron ese día: ${new Set(ch.map((m) => m.telefono)).size}\n`
  return txt.trim()
}

// Novedades que requieren atención (avisos sin leer del micrositio)
async function pendientes(sb: SupabaseClient): Promise<string> {
  const { data: av } = await sb.from('notificaciones').select('titulo').eq('leida', false).order('creado_en', { ascending: false }).limit(20)
  if (!av?.length) return ''
  return `⚠️ Tienes ${av.length} aviso${av.length === 1 ? '' : 's'} sin revisar en el micrositio:\n${av.slice(0, 4).map((a) => '• ' + a.titulo).join('\n')}${av.length > 4 ? '\n• …' : ''}`
}

// ---- Cancelación de los pedidos de un día con aviso a cada cliente ----
export async function vistaCancelacion(sb: SupabaseClient, fecha: string) {
  const ped = (await pedidosDe(sb, fecha)).filter((p) => !['cancelado', 'entregado'].includes(p.estado))
  return { ped, resumen: ped.map((p) => `• ${p.cliente_nombre}${p.cliente_telefono && p.cliente_telefono !== 'sin teléfono' ? ' (' + p.cliente_telefono + ')' : ''} — ${fmt$(p.total)}${p.pagado ? ' · ya pagó' : ''}`).join('\n') }
}

export async function ejecutarCancelacion(sb: SupabaseClient, fecha: string, motivo: string | null): Promise<string> {
  const { ped } = await vistaCancelacion(sb, fecha)
  // El día queda CERRADO en el calendario: el bot deja de ofrecer y de tomar reservas para esa fecha
  await sb.from('calendario_produccion').upsert({ fecha, tipo: 'cerrado', nota: motivo ? motivo.slice(0, 120) : 'Sin producción' }, { onConflict: 'fecha' })
  const cierre = `🔒 Cerré ${etiqueta(fecha, fechaBogota())} en el calendario: el bot ya no ofrece ni reserva para esa fecha (puedes reabrirlo en Calendario).`
  if (!ped.length) return `${cierre}
No había pedidos activos para cancelar.`
  await sb.from('pedidos').update({ estado: 'cancelado' }).in('id', ped.map((p) => p.id))
  const porTel = new Map<string, Ped[]>()
  const sinCanal: string[] = []
  for (const p of ped) {
    const tel = p.chat_telefono as string | null
    if (!tel) { sinCanal.push(`${p.cliente_nombre} (${p.cliente_telefono || 'sin teléfono'})`); continue }
    porTel.set(tel, [...(porTel.get(tel) ?? []), p])
  }
  let avisados = 0
  for (const [tel, lista] of porTel) {
    const { data: ult } = await sb.from('mensajes').select('creado_en').eq('telefono', tel).eq('rol', 'user').order('creado_en', { ascending: false }).limit(1).maybeSingle()
    const nombre = lista[0].cliente_nombre as string
    if (!ult || Date.now() - new Date(ult.creado_en).getTime() > 24 * 3600 * 1000) { sinCanal.push(`${nombre} (${lista[0].cliente_telefono || tel}) — fuera de la ventana de 24 h`); continue }
    const pago = lista.some((p) => p.pagado) ? ' Como ya habías pagado, te lo devolvemos o lo dejamos para otra fecha, como prefieras.' : ''
    const id = await sendText(tel, `Hola ${nombre.split(' ')[0]} 😊 Lamentamos avisarte que tuvimos que cancelar tu pedido para ${etiqueta(fecha, fechaBogota())}${motivo ? ': ' + motivo : ''}. Una disculpa por el inconveniente 🙏${pago} Cuando quieras te ayudamos a reprogramarlo.`)
    if (id) { avisados++; await sb.from('mensajes').insert({ telefono: tel, rol: 'assistant', contenido: 'Aviso de cancelación del pedido enviado por el equipo', wa_id: id }) } else sinCanal.push(`${nombre} (${lista[0].cliente_telefono || tel}) — WhatsApp no aceptó el mensaje`)
  }
  return `${cierre}\n✅ Cancelé ${ped.length} pedido${ped.length === 1 ? '' : 's'} de ${etiqueta(fecha, fechaBogota())} y avisé a ${avisados} cliente${avisados === 1 ? '' : 's'}.` +
    (sinCanal.length ? `\n\n⚠️ NO pude avisar a:\n${sinCanal.map((x) => '• ' + x).join('\n')}\nEscríbeles tú por otro medio.` : '')
}

// ---- Avisos al WhatsApp del admin aprovechando su ventana de 24 h abierta ----
// Cada aviso nuevo (pago, comprobante, atención, cambio…) se le envía también por WhatsApp si él escribió al bot en las últimas 24 h
// (así la "puerta" siempre abierta sirve de notificación). Si la ventana está cerrada, queda el aviso del micrositio y la notificación push.
const URGENTES = new Set(['atencion', 'sin_respuesta', 'pedido_grande', 'pago_revision', 'cancelacion'])
const ESPERA_URGENTE_S = 120 // entre un aviso por WhatsApp y el siguiente
const ESPERA_RESUMEN_MIN = 30 // los avisos no urgentes se agrupan y se envían como mucho cada 30 min

// Reserva el "turno" de envío (evita que varios avisos simultáneos salgan a la vez). Devuelve true si se puede enviar ahora.
async function turnoDeEnvio(sb: SupabaseClient, esperaSeg: number): Promise<boolean> {
  const { data } = await sb.from('config').select('valor').eq('clave', 'admin_wa_ultimo').maybeSingle()
  const ult = Number(data?.valor ?? 0)
  if (Date.now() - ult < esperaSeg * 1000) return false
  await sb.from('config').upsert({ clave: 'admin_wa_ultimo', valor: String(Date.now()) }, { onConflict: 'clave' })
  return true
}
const linea = (n: { caso?: number | null; titulo: string; detalle?: string | null; telefono?: string | null }) =>
  `${n.caso ? `#${n.caso} ` : ''}${n.titulo}${n.detalle ? ` — ${String(n.detalle).slice(0, 110)}` : ''}${n.telefono ? ` (chat ${n.telefono})` : ''}`

// Aviso nuevo al WhatsApp del admin. Cada aviso de chat lleva su número de caso (#12). Para no inundarlo cuando hay muchos clientes a la vez:
// los urgentes salen de inmediato solo si pasaron 2 min desde el último; el resto queda pendiente y se agrupa en un único resumen (ver digestAdmin).
export async function avisoAdminWA(sb: SupabaseClient, titulo: string, detalle?: string | null, chat?: string | null, o: { tipo?: string; id?: string; caso?: number } = {}): Promise<void> {
  try {
    const { data: c } = await sb.from('config').select('clave,valor').in('clave', ['admin_numeros', 'avisos_whatsapp_admin'])
    const cfg = Object.fromEntries((c ?? []).map((r) => [r.clave, r.valor])) as Record<string, string>
    if (cfg.avisos_whatsapp_admin === 'no') { if (o.id) await sb.from('notificaciones').update({ wa_enviado_en: new Date().toISOString() }).eq('id', o.id); return }
    if (!(!o.tipo || URGENTES.has(o.tipo)) || !(await turnoDeEnvio(sb, ESPERA_URGENTE_S))) return // queda pendiente para el resumen agrupado
    const texto = `🔔 ${o.caso ? `Caso #${o.caso} — ` : ''}${titulo}${detalle ? `\n${String(detalle).slice(0, 400)}` : ''}${chat ? `\n💬 Chat: ${chat}` : ''}\n\n${o.caso ? `Para responderle: "${o.caso}: tu mensaje" (o cita este aviso). ` : ''}Lo ves también en el micrositio.`
    const ok = await notificarAdmins(sb, cfg, texto, { excluir: chat })
    if (ok && o.id) await sb.from('notificaciones').update({ wa_enviado_en: new Date().toISOString() }).eq('id', o.id)
  } catch (e) { console.error('avisoAdminWA', e) }
}

// Resumen agrupado de los avisos pendientes de enviar por WhatsApp (lo llama el cron): una sola notificación, con números de caso para responder
export async function digestAdmin(sb: SupabaseClient, cfg: Record<string, string>): Promise<boolean> {
  if (cfg.avisos_whatsapp_admin === 'no') return false
  const { data: pend, error } = await sb.from('notificaciones').select('id,tipo,titulo,detalle,telefono,caso').is('wa_enviado_en', null).eq('leida', false)
    .gte('creado_en', new Date(Date.now() - 24 * 3600 * 1000).toISOString()).order('creado_en').limit(40)
  if (error || !pend?.length) return false
  const hayUrgente = pend.some((n) => URGENTES.has(n.tipo))
  if (!(await turnoDeEnvio(sb, hayUrgente ? ESPERA_URGENTE_S : ESPERA_RESUMEN_MIN * 60))) return false
  const lineas = pend.slice(0, 12).map((n) => `• ${linea(n)}`)
  const texto = `📋 ${pend.length} aviso${pend.length === 1 ? '' : 's'} pendiente${pend.length === 1 ? '' : 's'}:\n${lineas.join('\n')}${pend.length > 12 ? `\n… y ${pend.length - 12} más (mira "casos" o el micrositio)` : ''}\n\nResponde con "número: mensaje" (ej. "12: sí, claro"), cita un aviso, o "cerrar 12". "casos" lista los abiertos.`
  const ok = await notificarAdmins(sb, cfg, texto)
  if (ok) await sb.from('notificaciones').update({ wa_enviado_en: new Date().toISOString() }).in('id', pend.map((n) => n.id))
  return !!ok
}

// Resumen de aprendizaje del día: lo que el bot integró solo (mejoras sencillas) y lo que espera aprobación
export async function resumenAprendizaje(sb: SupabaseClient): Promise<string> {
  const { data: pend } = await sb.from('bot_aprendizajes').select('regla').eq('estado', 'pendiente').order('creado_en').limit(30)
  const desde = new Date(`${fechaBogota()}T00:00:00-05:00`).toISOString()
  const { data: auto } = await sb.from('bot_aprendizajes').select('regla').eq('estado', 'activa').like('evidencia', '%activada automáticamente%').gte('creado_en', desde).limit(10)
  if (!pend?.length && !auto?.length) return ''
  let t = '🧠 Aprendizaje del bot\n'
  if (auto?.length) t += `Hoy integré solo ${auto.length} mejora${auto.length === 1 ? '' : 's'} sencilla${auto.length === 1 ? '' : 's'} (de cómo se expresa el equipo): ${auto.slice(0, 3).map((x) => '«' + String(x.regla).slice(0, 70) + '»').join(' · ')}\n`
  if (pend?.length) t += `\nPendientes de tu aprobación (${pend.length}):\n${pend.slice(0, 6).map((x, i) => `${i + 1}. ${String(x.regla).slice(0, 140)}`).join('\n')}${pend.length > 6 ? '\n…' : ''}\n\nResponde "aprobar todo", "aprobar 1 y 3", "descartar 2" o dime qué aclarar.`
  return t.trim()
}

// ---- Resúmenes automáticos al admin (cron) ----
const claveEstado = (tel: string) => `admin_resumen_${tel}`
const horaCO = () => { const d = new Date(); const p = d.toLocaleTimeString('en-GB', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false }).split(':'); return { h: +p[0] % 24, m: +p[1] } }

export async function resumenAdmin(sb: SupabaseClient, cfg: Record<string, string>): Promise<string[]> {
  const hechos: string[] = []
  if (cfg.resumen_admin === 'no') return hechos
  const admins = (cfg.admin_numeros ?? '').split(',').map((x) => x.replace(/\D/g, '')).filter(Boolean)
  const { h, m } = horaCO()
  const hoy = fechaBogota()
  for (const tel of admins) {
    const { data: ult } = await sb.from('mensajes').select('creado_en').eq('telefono', tel).eq('rol', 'user').order('creado_en', { ascending: false }).limit(1).maybeSingle()
    if (!ult) continue
    const cierre = new Date(ult.creado_en).getTime() + 24 * 3600 * 1000
    const resta = (cierre - Date.now()) / 60000 // minutos de ventana que quedan
    if (resta <= 0) continue // ventana cerrada: solo se reabre cuando el admin escriba
    const k = claveEstado(tel)
    const { data: est } = await sb.from('config').select('valor').eq('clave', k).maybeSingle()
    const hecho = new Set(String(est?.valor ?? '').split('|').filter(Boolean))
    const marcar = async (tag: string) => { hecho.add(tag); await sb.from('config').upsert({ clave: k, valor: [...hecho].slice(-12).join('|') }, { onConflict: 'clave' }) }
    const pie = '\n\n💬 Respóndeme cualquier cosa (por ejemplo "ok") para mantener esta conversación abierta y poder seguir escribiéndote.'
    const novedades = async () => (await pendientes(sb)) || 'Sin novedades por revisar ✅'
    const cierraAntesDe7 = cierre < new Date(`${suma(hoy, 1)}T07:00:00-05:00`).getTime()
    let texto: string | null = null, tag = ''
    if (h === 19 && m < 10 && !hecho.has(`l:${hoy}`)) {
      // Fin del día: resumen corto de lo que aprendió y lo que necesita que apruebe o aclare
      tag = `l:${hoy}`
      const ap = await resumenAprendizaje(sb)
      if (!ap) { await marcar(tag); continue }
      texto = `${ap}${pie}`
    } else if (h === 18 && m < 10 && !hecho.has(`d:${hoy}`)) {
      tag = `d:${hoy}`
      texto = `🌇 Resumen de las 6 p. m.\n\n${await reporteDia(sb, hoy)}\n\n${await reporteDia(sb, suma(hoy, 1))}\n\n${await novedades()}${pie}`
    } else if (h === 21 && m < 10 && cierraAntesDe7 && !hecho.has(`n0:${ult.creado_en}`)) {
      tag = `n0:${ult.creado_en}`
      texto = `🌙 Buenas noches. Esta conversación se cierra durante la noche (WhatsApp solo deja escribirte 24 h después de tu último mensaje).\n\n${await novedades()}${pie}`
    } else if (resta <= 7 && h >= 6 && h < 22 && !hecho.has(`n2:${ult.creado_en}`)) {
      tag = `n2:${ult.creado_en}`
      texto = `⏳ La ventana de WhatsApp se cierra en unos minutos.\n\n${await novedades()}${pie}`
    } else if (resta <= 60 && h >= 6 && h < 22 && !hecho.has(`n1:${ult.creado_en}`)) {
      tag = `n1:${ult.creado_en}`
      texto = `👋 Hola, te escribo para mantener la conversación abierta (queda cerca de 1 h de ventana).\n\n${await novedades()}${pie}`
    }
    if (!texto) continue
    await marcar(tag) // primero se marca, para no repetir aunque el cron corra de nuevo
    if (await sendText(tel, texto)) hechos.push(`${tel}:${tag}`)
  }
  return hechos
}
