// Números del equipo (administradores, socios y domiciliario): NUNCA se tratan como clientes ni se les vende.
// Aquí tienen su propio asistente interno, con un prompt distinto al del bot de ventas: responde solo lo que preguntan y hace sugerencias breves.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { chat } from './ai.ts'
import { construirProveedor } from './config.ts'
import { sendText } from './wa.ts'
import { fechaBogota } from './tools.ts'
import { reporteDia } from './adminresumen.ts'

const REGLA_DURA = `REGLA DURA: la persona que te escribe es del EQUIPO de Mumi (no es un cliente). NUNCA la trates como cliente: no le vendas, no le ofrezcas el catálogo, no la saludes como a un comprador, no le pidas datos de pedido ni le des instrucciones de compra. Responde solo a lo que pregunta o pide, de forma breve y directa (máx. 6 líneas), en español y con tono cercano y profesional. Puedes añadir UNA sugerencia corta y útil si realmente aporta (producción, pagos pendientes, clientes por avisar). Usa solo los datos del contexto: si no lo sabes, dilo; no inventes cifras ni ingredientes.`

const SISTEMA_ADMIN = `Eres el asistente interno de Mumi (galletas y repostería por WhatsApp) para la administración y los socios. ${REGLA_DURA}
Lo que puedes hacer por ellos (guíalos si preguntan cómo): crear un pedido dictado ("pedido para Juan, 3 de maracuyá…"), un reporte ("dame un reporte de hoy"), cancelar los pedidos de un día avisando a los clientes, registrar el horneado ("hoy: cacao 30, limón 20"), fabricadas ("fabricadas: cacao 40"), avisos temporales ("evento: …", "instrucción: …"), subir fotos al catálogo (foto con el pie "foto: Cacao" o "nuevo: Nombre, precio, descripción") y devolver un chat al bot ("reanudar 57300…").`

const SISTEMA_DOMI = `Eres el asistente interno de Mumi para el domiciliario. ${REGLA_DURA}
Solo hablas de sus entregas: usa la lista del contexto (dirección, franja, si debe cobrar o ya está pago, estado). Para marcar una entrega usa los botones que le llegan; escribir "pedidos" lista lo pendiente. No des datos que no necesite para entregar.`

export async function conversarEquipo(sb: SupabaseClient, cfg: Record<string, string>, from: string, texto: string, rol: 'admin' | 'domiciliario'): Promise<void> {
  const hoy = fechaBogota()
  const hora = new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit', hour12: true })
  let contexto = `Hoy es ${new Date(hoy + 'T12:00:00Z').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })} (${hoy}), son las ${hora} (hora de Colombia).\n`
  if (rol === 'admin') {
    const manana = new Date(new Date(hoy + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10)
    const { data: av } = await sb.from('notificaciones').select('titulo').eq('leida', false).order('creado_en', { ascending: false }).limit(8)
    contexto += `${await reporteDia(sb, hoy)}\n\n${await reporteDia(sb, manana)}\n\nAvisos sin revisar en el micrositio: ${(av ?? []).map((a) => a.titulo).join(' · ') || 'ninguno'}\nDías de producción: ${cfg.dias_produccion ?? ''}. Franjas de entrega: ${cfg.franjas_entrega ?? ''}.`
  } else {
    const { data } = await sb.from('pedidos').select('cliente_nombre,cliente_telefono,direccion,franja_horaria,hora_entrega_solicitada,total,pagado,estado,metodo_pago')
      .eq('modalidad', 'domicilio').eq('fecha_entrega', hoy).neq('estado', 'cancelado').order('creado_en')
    contexto += `Entregas a domicilio de hoy:\n${(data ?? []).map((p) => `• ${p.cliente_nombre} — ${p.direccion ?? 'sin dirección'} — ${p.hora_entrega_solicitada ?? p.franja_horaria ?? 'sin hora'} — ${p.pagado ? 'PAGADO' : 'COBRAR $' + p.total + ' (' + (p.metodo_pago ?? '') + ')'} — ${p.estado}`).join('\n') || '(ninguna)'}`
  }
  const { data: hist } = await sb.from('mensajes').select('rol,contenido').eq('telefono', from).neq('contenido', '…').order('creado_en', { ascending: false }).limit(10)
  const mensajes = [...(hist ?? [])].reverse().map((m) => ({ role: m.rol === 'user' ? 'user' as const : 'assistant' as const, content: String(m.contenido).slice(0, 600) }))
  if (!mensajes.length || mensajes[mensajes.length - 1].role !== 'user' || mensajes[mensajes.length - 1].content !== texto) mensajes.push({ role: 'user', content: texto })
  try {
    const prov = await construirProveedor(sb, cfg)
    const out = (await chat(prov, `${rol === 'admin' ? SISTEMA_ADMIN : SISTEMA_DOMI}\n\n[Contexto]\n${contexto}`, mensajes, [], async () => ({}))).trim()
    if (!out) return
    const id = await sendText(from, out)
    if (id) await sb.from('mensajes').insert({ telefono: from, rol: 'assistant', contenido: out, wa_id: id })
  } catch (e) {
    console.error('conversarEquipo', e)
    await sendText(from, 'Ups, no pude procesar eso ahora 🙈 Intenta de nuevo en un momento.')
  }
}
