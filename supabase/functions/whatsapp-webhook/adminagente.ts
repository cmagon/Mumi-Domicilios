// Asistente del administrador por WhatsApp: canal OFICIAL para dar órdenes y modificar aspectos del negocio.
// Tiene su propio prompt (config `prompt_admin`, editable en el micrositio) y herramientas. Las acciones delicadas piden confirmación ("sí"/"no")
// y se ejecutan en código al confirmar (rápido y seguro); lo demás se hace al instante y se informa.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { chat, compactar, type Tool } from './ai.ts'
import { construirProveedor } from './config.ts'
import { sendImage, sendText, sendVideo } from './wa.ts'
import { fechaBogota } from './tools.ts'
import { ejecutarCancelacion, reporteDia, vistaCancelacion } from './adminresumen.ts'
import { comandoAviso } from './avisos.ts'
import { flujoPedido } from './adminpedido.ts'
import { casosAbiertos, chatDeCaso, despuesDeResponder, ventanaCliente } from './casos.ts'

export const PROMPT_ADMIN_DEFAULT = `# ROL
Eres el asistente interno de Mumi (galletas y repostería artesanal por WhatsApp) para la administración y los socios. Este chat es el canal OFICIAL para recibir sus órdenes y modificar aspectos del negocio. La persona que te escribe es del equipo, NUNCA un cliente: no vendas, no ofrezcas el catálogo, no la saludes como comprador ni le pidas datos de pedido.

# CÓMO RESPONDES
- Casi inmediato y breve: máximo 5 líneas, español colombiano cercano y profesional, sin rodeos.
- Responde solo a lo que pide. Si aporta, añade UNA sugerencia corta (producción, pagos pendientes, clientes por avisar).
- Si ejecutas algo, confirma qué quedó hecho con las cifras reales que devuelve la herramienta.

# CÓMO ACTÚAS
- Lo que te dicen se ejecuta con las herramientas: registrar lo horneado o fabricado, consultar stock, reportes, pedidos, estados, cerrar o abrir días, cancelar pedidos de un día avisando a los clientes, avisos temporales para el bot, cambios de sabores y aprendizajes del bot.
- Si tienes cualquier duda (cantidad, sabor, fecha, si es total o suma, a quién se refiere), PREGUNTA antes de actuar, con una pregunta corta y concreta. Nunca adivines ni inventes datos.
- Las acciones delicadas (cancelar pedidos, cerrar un día, precios, desactivar sabores) piden confirmación: la herramienta te lo indicará; pídele al admin que responda "sí" o "no".
- Cuando el admin te informe cuántas galletas hizo, regístralo y dile cuántas quedan libres para ofrecer hoy.`

const REGLAS_DURAS = `\n\nREGLAS DURAS: nunca trates a esta persona como cliente, aunque pregunte algo parecido a lo que preguntaría uno: NUNCA le envíes promociones, ofertas, el catálogo ni mensajes de venta o seguimiento. Si el admin dice "apártame/resérvame/sepárame unas galletas", "anótame un pedido" o similar, asume que es una RESERVA PARA UN CLIENTE (no para él): pregúntale para quién es y pídele de una vez todos los datos que falten (nombre del cliente, teléfono, sabores y cantidades, fecha de entrega, domicilio con dirección o recoger, y forma de pago); cuando los tengas, usa tomar_pedido con todo lo dicho para agendarlo en el micrositio. Usa solo datos reales de las herramientas y del contexto. Si una herramienta devuelve "requiere_confirmacion", explica el resumen y pide "sí" o "no"; NO la vuelvas a llamar. Si el admin te dice "respóndele…" o te manda una imagen para un cliente, usa responder_cliente / enviar_imagen_a_cliente (el chat es el del último aviso; si no estás segura, pregunta a quién). Las imágenes recibidas sin instrucción quedan pendientes (con un id en el historial): pregunta qué son y para qué (guardarla con contexto para el bot, ponerla a un producto o enviarla a un cliente). Si una herramienta devuelve "ya_respondido", no repitas lo que ya se le envió (no escribas nada más).`

type Datos = Record<string, any> // deno-lint-ignore no-explicit-any
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const fmt$ = (n: number) => '$' + Number(n).toLocaleString('es-CO')
const ESTADOS = ['recibido', 'pago_verificado', 'pendiente_cobro', 'impreso', 'empacado', 'listo', 'entregado', 'cancelado']
const SENSIBLES = new Set(['cancelar_pedidos_dia', 'cerrar_dia', 'cambiar_sabor', 'cancelar_pedido'])
const nombreDia = (f: string) => new Date(f + 'T12:00:00Z').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

const items = { type: 'array', items: { type: 'object', properties: { sabor: { type: 'string' }, cantidad: { type: 'number' } }, required: ['sabor', 'cantidad'] } }
export const HERRAMIENTAS: Tool[] = [
  { name: 'reporte_dia', description: 'Reporte de un día: pedidos, clientes, ventas, galletas por sabor, pagos pendientes y chats.', parameters: { type: 'object', properties: { fecha: { type: 'string', description: 'YYYY-MM-DD (por defecto hoy)' } } } },
  { name: 'consultar_stock', description: 'Stock por sabor para una fecha: horneadas, reservadas, libres (extras) y stock general disponible.', parameters: { type: 'object', properties: { fecha: { type: 'string', description: 'YYYY-MM-DD (por defecto hoy)' } } } },
  { name: 'registrar_horneado', description: 'Registra lo que se HORNEA para una fecha (por defecto hoy). modo "total" (por defecto) fija el total horneado del día; "sumar" lo añade a lo ya registrado. Si el admin no aclara si es total o suma y ya había algo registrado, pregunta.', parameters: { type: 'object', properties: { items, fecha: { type: 'string' }, modo: { type: 'string', enum: ['total', 'sumar'] } }, required: ['items'] } },
  { name: 'registrar_fabricadas', description: 'Suma galletas fabricadas/congeladas al stock general (las que se hornearán en próximas producciones).', parameters: { type: 'object', properties: { items }, required: ['items'] } },
  { name: 'listar_pedidos', description: 'Lista los pedidos de una fecha de entrega (número, cliente, sabores, estado, pago).', parameters: { type: 'object', properties: { fecha: { type: 'string' } } } },
  { name: 'cambiar_estado_pedido', description: 'Cambia el estado de un pedido por su número (recibido, pago_verificado, pendiente_cobro, impreso, empacado, listo, entregado). Para cancelar usa cancelar_pedido.', parameters: { type: 'object', properties: { numero: { type: 'number' }, estado: { type: 'string', enum: ESTADOS.filter((e) => e !== 'cancelado') } }, required: ['numero', 'estado'] } },
  { name: 'cancelar_pedido', description: 'Cancela UN pedido por su número (pide confirmación al admin).', parameters: { type: 'object', properties: { numero: { type: 'number' } }, required: ['numero'] } },
  { name: 'cancelar_pedidos_dia', description: 'Cancela TODOS los pedidos activos de una fecha, avisa a cada cliente por WhatsApp y cierra esa fecha en el calendario (pide confirmación).', parameters: { type: 'object', properties: { fecha: { type: 'string' }, motivo: { type: 'string', description: 'Razón breve y amable para los clientes, sin datos internos' } }, required: ['fecha'] } },
  { name: 'cerrar_dia', description: 'Cierra una fecha en el calendario (sin producción ni entregas): el bot deja de ofrecerla (pide confirmación).', parameters: { type: 'object', properties: { fecha: { type: 'string' }, motivo: { type: 'string' } }, required: ['fecha'] } },
  { name: 'abrir_dia', description: 'Reabre una fecha que estaba cerrada en el calendario.', parameters: { type: 'object', properties: { fecha: { type: 'string' } }, required: ['fecha'] } },
  { name: 'cambiar_sabor', description: 'Cambia el precio y/o activa o desactiva un sabor del catálogo (pide confirmación).', parameters: { type: 'object', properties: { nombre: { type: 'string' }, precio: { type: 'number' }, activo: { type: 'boolean' } }, required: ['nombre'] } },
  { name: 'aviso_temporal', description: 'Crea una instrucción o aviso temporal para el bot de ventas (eventos, cambios de horario, promociones, disponibilidad). Ya le responde al admin con el resultado.', parameters: { type: 'object', properties: { texto: { type: 'string', description: 'Lo que dijo el admin, completo y con fechas/horas si las dio' } }, required: ['texto'] } },
  { name: 'tomar_pedido', description: 'Cuando el admin dicta un pedido para otra persona: arma el borrador, pregunta lo que falte y pide confirmación. Ya le responde al admin.', parameters: { type: 'object', properties: { texto: { type: 'string', description: 'El pedido tal como lo dictó, completo' } }, required: ['texto'] } },
  { name: 'gestionar_aprendizajes', description: 'Reglas que el bot propone aprender y esperan aprobación del admin. accion: listar | aprobar | descartar. Los números son los de la lista.', parameters: { type: 'object', properties: { accion: { type: 'string', enum: ['listar', 'aprobar', 'descartar'] }, numeros: { type: 'array', items: { type: 'number' } }, todos: { type: 'boolean' } }, required: ['accion'] } },
  { name: 'responder_cliente', description: 'Responde a un cliente en su chat con el texto que el admin indicó (redáctalo breve, cálido y con el tono del bot, sin datos internos ni números de pedido). Sin teléfono usa el último chat por el que avisaste al admin. Le llega al cliente como respuesta normal y el bot sigue atendiendo después. Solo funciona si el cliente escribió en las últimas 24 h.', parameters: { type: 'object', properties: { texto: { type: 'string' }, caso: { type: 'number', description: 'Número de caso (#12) del aviso' }, telefono: { type: 'string', description: 'Teléfono del chat (si no hay caso)' } }, required: ['texto'] } },
  { name: 'enviar_imagen_a_cliente', description: 'Envía a un cliente una imagen o video que el admin mandó (por id), con un texto opcional. Sin teléfono usa el último chat por el que avisaste al admin.', parameters: { type: 'object', properties: { imagen_id: { type: 'string' }, texto: { type: 'string' }, caso: { type: 'number' }, telefono: { type: 'string' } }, required: ['imagen_id'] } },
  { name: 'guardar_imagen_bot', description: 'Guarda una imagen/video recibida en la biblioteca del bot con su contexto (qué es y cuándo usarla), para que el bot la use en las conversaciones. Ej.: "así se ven las galletas en una caja".', parameters: { type: 'object', properties: { imagen_id: { type: 'string' }, descripcion: { type: 'string', description: 'Contexto claro y corto' } }, required: ['imagen_id', 'descripcion'] } },
  { name: 'asignar_imagen_producto', description: 'Agrega una imagen recibida a un producto del catálogo; con principal=true pasa a ser su foto principal (actualizar la foto).', parameters: { type: 'object', properties: { imagen_id: { type: 'string' }, sabor: { type: 'string' }, principal: { type: 'boolean' } }, required: ['imagen_id', 'sabor'] } },
  { name: 'listar_imagenes_bot', description: 'Imágenes y videos guardados en la biblioteca del bot.', parameters: { type: 'object', properties: {} } },
  { name: 'quitar_imagen_bot', description: 'Quita una imagen de la biblioteca del bot (el bot deja de usarla).', parameters: { type: 'object', properties: { imagen_id: { type: 'string' } }, required: ['imagen_id'] } },
  { name: 'reanudar_chat', description: 'Devuelve al bot el chat de un cliente (teléfono con indicativo).', parameters: { type: 'object', properties: { telefono: { type: 'string' } }, required: ['telefono'] } },
]

async function productos(sb: SupabaseClient) { return ((await sb.from('productos').select('id,nombre,precio,activo')).data ?? []) as Datos[] }
const buscar = (ps: Datos[], q: string) => ps.find((p) => norm(p.nombre) === norm(q)) ?? ps.find((p) => norm(p.nombre).includes(norm(q)) || norm(q).includes(norm(p.nombre).split(' ')[0]))
const fechaOk = (f?: string) => (f && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : fechaBogota())

async function pendientesAprendizaje(sb: SupabaseClient) {
  return ((await sb.from('bot_aprendizajes').select('id,regla,categoria,creado_en').eq('estado', 'pendiente').order('creado_en').limit(30)).data ?? []) as Datos[]
}

// Acciones delicadas: se ejecutan SOLO tras el "sí" del admin
export async function ejecutarAccion(sb: SupabaseClient, tool: string, a: Datos): Promise<string> {
  const hoy = fechaBogota()
  if (tool === 'cancelar_pedidos_dia') return await ejecutarCancelacion(sb, fechaOk(a.fecha), a.motivo ?? null)
  if (tool === 'cerrar_dia') {
    await sb.from('calendario_produccion').upsert({ fecha: fechaOk(a.fecha), tipo: 'cerrado', nota: a.motivo ? String(a.motivo).slice(0, 120) : 'Sin producción' }, { onConflict: 'fecha' })
    return `🔒 Listo, cerré ${nombreDia(fechaOk(a.fecha))}: el bot ya no ofrece ni reserva esa fecha.`
  }
  if (tool === 'cancelar_pedido') {
    const { data: p } = await sb.from('pedidos').update({ estado: 'cancelado' }).eq('numero', a.numero).select('numero,cliente_nombre').maybeSingle()
    return p ? `✅ Cancelé el pedido #${p.numero} de ${p.cliente_nombre}. (No se avisó al cliente; si quieres, escríbele desde el micrositio.)` : `No encontré el pedido #${a.numero}.`
  }
  if (tool === 'cambiar_sabor') {
    const p = buscar(await productos(sb), String(a.nombre))
    if (!p) return `No encontré el sabor "${a.nombre}".`
    const cambios: Datos = {}
    if (typeof a.precio === 'number' && a.precio > 0) cambios.precio = Math.round(a.precio)
    if (typeof a.activo === 'boolean') cambios.activo = a.activo
    if (!Object.keys(cambios).length) return 'No había nada que cambiar.'
    await sb.from('productos').update(cambios).eq('id', p.id)
    return `✅ ${p.nombre}: ${[cambios.precio != null ? `precio ${fmt$(cambios.precio)}` : '', cambios.activo != null ? (cambios.activo ? 'activo' : 'desactivado') : ''].filter(Boolean).join(' · ')}.`
  }
  void hoy
  return 'Acción no reconocida.'
}

async function resumenPendiente(sb: SupabaseClient, tool: string, a: Datos): Promise<string> {
  if (tool === 'cancelar_pedidos_dia') {
    const v = await vistaCancelacion(sb, fechaOk(a.fecha))
    return `Cancelar y avisar a ${v.ped.length} cliente(s) los pedidos de ${nombreDia(fechaOk(a.fecha))} y CERRAR esa fecha${a.motivo ? ` (motivo: ${a.motivo})` : ''}.${v.ped.length ? '\n' + v.resumen : ''}`
  }
  if (tool === 'cerrar_dia') return `Cerrar ${nombreDia(fechaOk(a.fecha))} (sin producción ni entregas)${a.motivo ? `: ${a.motivo}` : ''}.`
  if (tool === 'cancelar_pedido') {
    const { data: p } = await sb.from('pedidos').select('numero,cliente_nombre,total,estado').eq('numero', a.numero).maybeSingle()
    return p ? `Cancelar el pedido #${p.numero} de ${p.cliente_nombre} (${fmt$(p.total)}, estado ${p.estado}).` : `Cancelar el pedido #${a.numero} (no lo encuentro).`
  }
  const p = buscar(await productos(sb), String(a.nombre))
  return `Cambiar ${p?.nombre ?? a.nombre}: ${[a.precio != null ? `precio de ${fmt$(p?.precio ?? 0)} a ${fmt$(a.precio)}` : '', a.activo != null ? (a.activo ? 'activarlo' : 'desactivarlo') : ''].filter(Boolean).join(' y ')}.`
}

type Estado = { respondido: boolean }
async function herramienta(sb: SupabaseClient, cfg: Record<string, string>, from: string, name: string, a: Datos, st: Estado): Promise<unknown> {
  const hoy = fechaBogota()
  if (SENSIBLES.has(name)) {
    const resumen = await resumenPendiente(sb, name, a)
    await sb.from('admin_borradores').upsert({ admin_telefono: from, crudo: name, datos: { tipo: 'accion', tool: name, args: a, resumen }, estado: 'confirmar', actualizado_en: new Date().toISOString() }, { onConflict: 'admin_telefono' })
    return { requiere_confirmacion: true, resumen, instruccion: 'Explícale esto al admin y pídele que responda "sí" para confirmar o "no" para descartar.' }
  }
  switch (name) {
    case 'reporte_dia': return { reporte: await reporteDia(sb, fechaOk(a.fecha)) }
    case 'consultar_stock': {
      const f = fechaOk(a.fecha)
      const filas = ((await sb.rpc('stock_resumen', { p_fecha: f })).data ?? []) as Datos[]
      return { fecha: f, sabores: filas.filter((r) => r.activo).map((r) => ({ sabor: r.nombre, horneado_registrado: r.horneado_registrado, horneadas: r.horneadas_dia, reservadas: Number(r.reservadas_dia), libres: Number(r.extras_dia), stock_general_disponible: Number(r.disponible_general) })) }
    }
    case 'registrar_horneado': {
      const f = fechaOk(a.fecha)
      if (f < hoy) return { error: 'Esa fecha ya pasó; pregunta la fecha correcta.' }
      const ps = await productos(sb)
      const antes = new Map(((await sb.from('produccion_dia').select('producto_id,horneadas').eq('fecha', f)).data ?? []).map((r: Datos) => [r.producto_id, Number(r.horneadas)]))
      const hechos: string[] = [], noEncontrados: string[] = []
      for (const it of (a.items ?? []) as Datos[]) {
        const p = buscar(ps, String(it.sabor)); const c = Math.round(Number(it.cantidad))
        if (!p) { noEncontrados.push(String(it.sabor)); continue }
        if (!Number.isFinite(c) || c < 0 || c > 2000) { noEncontrados.push(`${it.sabor} (cantidad rara)`); continue }
        const total = a.modo === 'sumar' ? (antes.get(p.id) ?? 0) + c : c
        await sb.from('produccion_dia').upsert({ fecha: f, producto_id: p.id, horneadas: total, actualizado_en: new Date().toISOString() }, { onConflict: 'fecha,producto_id' })
        hechos.push(p.nombre)
      }
      const filas = ((await sb.rpc('stock_resumen', { p_fecha: f })).data ?? []) as Datos[]
      return { fecha: f, registrado: filas.filter((r) => hechos.includes(r.nombre)).map((r) => ({ sabor: r.nombre, horneadas: r.horneadas_dia, reservadas: Number(r.reservadas_dia), libres_para_ofrecer: Number(r.extras_dia) })), no_encontrados: noEncontrados, nota: noEncontrados.length ? 'Pregunta al admin por los sabores/cantidades que no se entendieron.' : undefined }
    }
    case 'registrar_fabricadas': {
      const ps = await productos(sb); const ok: string[] = [], no: string[] = []
      for (const it of (a.items ?? []) as Datos[]) {
        const p = buscar(ps, String(it.sabor)); const c = Math.round(Number(it.cantidad))
        if (!p || !Number.isFinite(c) || c < 1 || c > 5000) { no.push(String(it.sabor)); continue }
        await sb.from('stock_lotes').insert({ producto_id: p.id, cantidad: c, nota: 'Registrado por WhatsApp', fecha: hoy }); ok.push(`${p.nombre} +${c}`)
      }
      return { sumado_al_stock_general: ok, no_encontrados: no }
    }
    case 'listar_pedidos': {
      const f = fechaOk(a.fecha)
      const { data } = await sb.from('pedidos').select('numero,cliente_nombre,estado,pagado,total,modalidad,metodo_pago,pedido_items(cantidad,productos(nombre))').eq('fecha_entrega', f).order('numero').limit(40)
      return { fecha: f, pedidos: (data ?? []).map((p: Datos) => ({ numero: p.numero, cliente: p.cliente_nombre, estado: p.estado, pagado: p.pagado, total: p.total, modalidad: p.modalidad, sabores: (p.pedido_items ?? []).map((i: Datos) => `${i.cantidad} ${i.productos?.nombre}`).join(', ') })) }
    }
    case 'cambiar_estado_pedido': {
      if (!ESTADOS.includes(String(a.estado)) || a.estado === 'cancelado') return { error: 'Estado no válido' }
      const { data: p } = await sb.from('pedidos').update({ estado: a.estado, ...(a.estado === 'entregado' ? { pagado: true } : {}) }).eq('numero', a.numero).select('numero,cliente_nombre').maybeSingle()
      return p ? { ok: true, pedido: p.numero, cliente: p.cliente_nombre, estado: a.estado } : { error: `No encontré el pedido #${a.numero}` }
    }
    case 'abrir_dia': {
      const { data } = await sb.from('calendario_produccion').delete().eq('fecha', fechaOk(a.fecha)).eq('tipo', 'cerrado').select('fecha')
      return data?.length ? { ok: true, nota: `Reabrí ${nombreDia(fechaOk(a.fecha))}` } : { ok: false, nota: 'Esa fecha no estaba cerrada en el calendario (si la cerró un aviso temporal, quítalo con "avisos").' }
    }
    case 'aviso_temporal': {
      st.respondido = true
      await comandoAviso(sb, cfg, from, `instrucción: ${String(a.texto ?? '')}`)
      return { ya_respondido: true }
    }
    case 'tomar_pedido': {
      st.respondido = true
      await flujoPedido(sb, cfg, from, String(a.texto ?? ''), false, null)
      return { ya_respondido: true }
    }
    case 'gestionar_aprendizajes': {
      const l = await pendientesAprendizaje(sb)
      const lista = l.map((x, i) => `${i + 1}. ${x.regla}`)
      if (a.accion === 'listar') return { pendientes: lista.length ? lista : 'No hay reglas pendientes.' }
      const idx = a.todos ? l.map((_, i) => i + 1) : ((a.numeros ?? []) as number[])
      const objetivo = idx.map((n) => l[n - 1]).filter(Boolean)
      if (!objetivo.length) return { error: 'No encontré esos números', pendientes: lista }
      await sb.from('bot_aprendizajes').update({ estado: a.accion === 'aprobar' ? 'activa' : 'descartada', decidido_en: new Date().toISOString() }).in('id', objetivo.map((x) => x.id))
      return { ok: true, [a.accion === 'aprobar' ? 'aprobadas' : 'descartadas']: objetivo.map((x) => x.regla), quedan_pendientes: l.length - objetivo.length }
    }
    case 'responder_cliente': {
      const tel = await destinoCliente(sb, from, a)
      if (!tel) return { error: 'No sé a qué cliente responder: hay varios casos abiertos o ninguno. Pregúntale al admin el número de caso (#) o el nombre.' }
      if (!(await ventanaCliente(sb, tel))) return { ventana_cerrada: true, error: 'Pasaron más de 24 h desde el último mensaje de ese cliente: WhatsApp no permite escribirle hasta que él escriba.' }
      const texto = String(a.texto ?? '').trim()
      if (!texto) return { error: 'Falta el texto' }
      const id = await sendText(tel, texto)
      if (!id) return { error: 'WhatsApp no aceptó el mensaje' }
      await despuesDeResponder(sb, tel, texto, id)
      return { ok: true, enviado_a: tel, nota: 'Ya se envió al cliente; el bot sigue atendiendo ese chat.' }
    }
    case 'enviar_imagen_a_cliente': {
      const tel = await destinoCliente(sb, from, a)
      if (!tel) return { error: 'No sé a qué cliente enviársela: hay varios casos abiertos o ninguno. Pregúntale al admin el número de caso (#) o el nombre.' }
      if (!(await ventanaCliente(sb, tel))) return { ventana_cerrada: true, error: 'Pasaron más de 24 h desde el último mensaje de ese cliente.' }
      const { data: im } = await sb.from('bot_imagenes').select('url,tipo').eq('id', String(a.imagen_id)).maybeSingle()
      if (!im) return { error: 'No encontré esa imagen' }
      const texto = String(a.texto ?? '').trim() || undefined
      const id = im.tipo === 'video' ? await sendVideo(tel, im.url, texto) : await sendImage(tel, im.url, texto)
      if (!id) return { error: 'WhatsApp no aceptó el archivo' }
      await despuesDeResponder(sb, tel, `[Imagen enviada por el equipo${texto ? ': ' + texto : ''}]`, id)
      return { ok: true, enviado_a: tel, nota: 'Enviada. Si el admin quiere guardarla para el bot, usa guardar_imagen_bot.' }
    }
    case 'guardar_imagen_bot': {
      const { data } = await sb.from('bot_imagenes').update({ descripcion: String(a.descripcion ?? '').trim().slice(0, 300), activo: true }).eq('id', String(a.imagen_id)).select('id').maybeSingle()
      return data ? { ok: true, nota: 'Guardada: el bot ya puede usarla en las conversaciones.' } : { error: 'No encontré esa imagen' }
    }
    case 'asignar_imagen_producto': {
      const p = buscar(await productos(sb), String(a.sabor))
      if (!p) return { error: `No encontré el sabor "${a.sabor}"` }
      const { data: im } = await sb.from('bot_imagenes').select('id,url,tipo').eq('id', String(a.imagen_id)).maybeSingle()
      if (!im) return { error: 'No encontré esa imagen' }
      const { data: medios } = await sb.from('producto_medios').select('id,principal,tipo').eq('producto_id', p.id)
      const principal = im.tipo === 'image' && (a.principal === true || !(medios ?? []).some((x: Datos) => x.principal && x.tipo === 'image'))
      if (principal) await sb.from('producto_medios').update({ principal: false }).eq('producto_id', p.id)
      await sb.from('producto_medios').insert({ producto_id: p.id, url: im.url, tipo: im.tipo, principal, orden: (medios ?? []).length })
      if (principal) await sb.from('productos').update({ foto_url: im.url }).eq('id', p.id)
      await sb.from('bot_imagenes').delete().eq('id', im.id) // pasó al producto
      return { ok: true, producto: p.nombre, foto_principal: principal }
    }
    case 'listar_imagenes_bot': {
      const { data } = await sb.from('bot_imagenes').select('id,descripcion,tipo,activo').order('creado_en', { ascending: false }).limit(30)
      return { imagenes: (data ?? []).filter((x: Datos) => x.activo).map((x: Datos) => ({ id: x.id, tipo: x.tipo, descripcion: x.descripcion })) }
    }
    case 'quitar_imagen_bot': {
      await sb.from('bot_imagenes').update({ activo: false }).eq('id', String(a.imagen_id))
      return { ok: true }
    }
    case 'reanudar_chat': {
      const t = String(a.telefono ?? '').replace(/\D/g, '')
      await sb.from('conversaciones').update({ humano: false, humano_desde: null }).eq('telefono', t)
      return { ok: true, nota: `Bot reactivado para ${t}` }
    }
  }
  return { error: 'herramienta desconocida' }
}

// Último chat de cliente por el que se le avisó al admin (el aviso queda en su historial con "Chat del cliente: <teléfono>" o "Chat: <teléfono>")
export async function ultimoChatAviso(sb: SupabaseClient, admin: string): Promise<string | null> {
  const { data } = await sb.from('mensajes').select('contenido').eq('telefono', admin).eq('rol', 'assistant').order('creado_en', { ascending: false }).limit(15)
  for (const m of data ?? []) { const x = String(m.contenido).match(/Chat(?: del cliente)?:\s*(\d{10,15})/); if (x) return x[1] }
  return null
}
// A qué cliente va la respuesta: número de caso > teléfono > único caso abierto (con varios abiertos, hay que preguntar)
async function destinoCliente(sb: SupabaseClient, admin: string, a: Datos): Promise<string | null> {
  if (a.caso) return (await chatDeCaso(sb, Number(a.caso)))?.telefono ?? null
  const t = String(a.telefono ?? '').replace(/\D/g, '')
  if (t) return t
  const abiertos = await casosAbiertos(sb, 5)
  if (abiertos.length === 1) return abiertos[0].telefono
  if (abiertos.length === 0) return await ultimoChatAviso(sb, admin)
  return null
}

export async function agenteAdmin(sb: SupabaseClient, cfg: Record<string, string>, from: string): Promise<void> {
  const hoy = fechaBogota()
  const hora = new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit', hour12: true })
  const [{ data: hist }, pend, bor, casos] = await Promise.all([
    sb.from('mensajes').select('rol,contenido').eq('telefono', from).neq('contenido', '…').order('creado_en', { ascending: false }).limit(14),
    pendientesAprendizaje(sb),
    sb.from('admin_borradores').select('datos,actualizado_en').eq('admin_telefono', from).maybeSingle(),
    casosAbiertos(sb, 8),
  ])
  const accion = bor.data && Date.now() - new Date(bor.data.actualizado_en).getTime() < 30 * 60000 && bor.data.datos?.tipo === 'accion' ? bor.data.datos : null
  const contexto = `[Contexto] Hoy es ${nombreDia(hoy)} (${hoy}), son las ${hora} (hora de Colombia). Días de producción: ${cfg.dias_produccion ?? ''}. Franjas de entrega: ${cfg.franjas_entrega ?? ''}.` +
    (pend.length ? ` Reglas del bot por aprobar: ${pend.length}.` : '') +
    (casos.length ? ` Casos abiertos (avisos de clientes que esperan al admin): ${casos.map((c) => `#${c.caso} ${c.titulo.slice(0, 50)}${c.detalle ? ' — ' + String(c.detalle).slice(0, 70) : ''}`).join(' | ')}. Si el admin dice "respóndele…" sin indicar cuál y hay VARIOS casos, pregúntale a cuál (por número o nombre); si hay uno solo, es ese.` : '') +
    (accion ? ` ACCIÓN EN ESPERA DE CONFIRMACIÓN: ${accion.resumen} (el admin debe responder "sí" o "no"; si cambia de idea o corrige algo, llama de nuevo la herramienta con los datos correctos).` : '')
  const turnos = compactar([...(hist ?? [])].reverse() as { rol: string; contenido: string }[])
  const st: Estado = { respondido: false }
  try {
    const prov = await construirProveedor(sb, cfg)
    if (cfg.modelo_admin?.trim()) prov.modelo = cfg.modelo_admin.trim() // modelo propio (más rápido) para el admin
    const sistema = `${(cfg.prompt_admin ?? '').trim() || PROMPT_ADMIN_DEFAULT}${REGLAS_DURAS}\n\n${contexto}`
    const out = (await chat(prov, sistema, turnos, HERRAMIENTAS, async (n, args) => {
      try { return await herramienta(sb, cfg, from, n, args as Datos, st) } catch (e) { console.error('herramienta admin', n, e); return { error: String((e as Error).message ?? e) } }
    })).trim()
    if (st.respondido && !out) return
    if (!out) return
    const id = await sendText(from, out)
    if (id) await sb.from('mensajes').insert({ telefono: from, rol: 'assistant', contenido: out, wa_id: id })
  } catch (e) {
    console.error('agenteAdmin', e)
    await sendText(from, 'Ups, no pude procesar eso ahora 🙈 Intenta de nuevo en un momento.')
  }
}
