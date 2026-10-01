import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { Tool, Provider } from './ai.ts'
import { leerComprobante } from './ai.ts'
import { notify } from './wa.ts'

export const TZ = 'America/Bogota'
export const fechaBogota = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
const sinAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export const diaSemana = (fecha: string) => DIAS[new Date(fecha + 'T12:00:00Z').getUTCDay()]

// Calendario especial: días extra de producción ('produccion') o días cerrados por feria/evento/descanso ('cerrado')
export type Excepciones = Map<string, { tipo: string; nota: string | null }>
export async function cargarExcepciones(sb: SupabaseClient): Promise<Excepciones> {
  const { data } = await sb.from('calendario_produccion').select('fecha,tipo,nota').gte('fecha', fechaBogota())
  return new Map((data ?? []).map((r: any) => [String(r.fecha), { tipo: r.tipo as string, nota: (r.nota as string | null) ?? null }]))
}
export function esDiaProduccion(fecha: string, dias: string, ex?: Excepciones) {
  const e = ex?.get(fecha)
  if (e) return e.tipo === 'produccion'
  return dias.split(',').map((d) => sinAcento(d.trim())).includes(diaSemana(fecha))
}
export function proximaProduccion(desde: string, dias: string, incluirHoy: boolean, ex?: Excepciones) {
  const d = new Date(desde + 'T12:00:00Z')
  for (let i = incluirHoy ? 0 : 1; i < 90; i++) {
    const c = new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10)
    if (esDiaProduccion(c, dias, ex)) return c
  }
  return null
}

const fechaLarga = (f: string) => new Date(f + 'T12:00:00Z').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).replace(',', '')
const minutosAhora = () => { const p = new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).split(':'); return (+p[0] % 24) * 60 + +p[1] }
// Fin de la última franja de entrega (ej. "14:00-16:00,16:00-18:00" → 18:00). Después de esa hora ya no hay entregas hoy.
export function cierreEntregas(franjas: string): { min: number; texto: string } | null {
  const fines = [...(franjas ?? '').matchAll(/-\s*(\d{1,2})(?::(\d{2}))?/g)].map((m) => +m[1] * 60 + (+m[2] || 0))
  if (!fines.length) return null
  const min = Math.max(...fines)
  const h = Math.floor(min / 60), m = min % 60
  return { min, texto: `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h >= 12 ? 'p. m.' : 'a. m.'}` }
}
// Primera fecha de entrega posible: hoy si es día de producción y aún se toman pedidos (hasta `margen` min antes del cierre); si no, la próxima producción.
export function fechaEntregaSugerida(hoy: string, dias: string, franjas: string, margen = 60, ex?: Excepciones) {
  const cierre = cierreEntregas(franjas)
  const hoyOk = esDiaProduccion(hoy, dias, ex) && (!cierre || minutosAhora() < cierre.min - margen)
  return { fecha: hoyOk ? hoy : proximaProduccion(hoy, dias, false, ex), cierre }
}
const manana = (hoy: string) => new Date(new Date(hoy + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10)

const ANTES_DE_IMPRIMIR = ['recibido', 'pago_verificado', 'pendiente_cobro']
const PAGO_BASE = ['efectivo', 'contra ?entrega', 'al recibir', 'consign', 'transfer', 'pagar', 'pagarte', 'pagaré']
const escRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Métodos de pago válidos: solo los de la configuración (tabla metodos_pago) y el efectivo si está habilitado
async function metodosDisponibles(sb: SupabaseClient, cfg: Record<string, string>) {
  const { data } = await sb.from('metodos_pago').select('nombre,numero_cuenta,tipo_cuenta').eq('activo', true)
  return { medios: data ?? [], efectivo: cfg.acepta_efectivo !== 'no' }
}
function metodoValido(metodo: string, m: { medios: { nombre: string }[]; efectivo: boolean }) {
  const mp = sinAcento(metodo ?? '')
  if (mp.includes('efectivo')) return m.efectivo
  return m.medios.some((x) => { const n = sinAcento(x.nombre); return mp.includes(n) || n.includes(mp) })
}
const listaMetodos = (m: { medios: { nombre: string }[]; efectivo: boolean }) => [...m.medios.map((x) => x.nombre), ...(m.efectivo ? ['Efectivo contraentrega'] : [])].join(', ')
const normalizarHora = (h: unknown): string | null => {
  const m = String(h ?? '').trim().match(/^(\d{1,2}):(\d{2})/)
  return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

// Pedido vigente de este chat (aún no entregado ni cancelado)
export async function pedidoActivo(sb: SupabaseClient, chat: string) {
  const { data } = await sb.from('pedidos')
    .select('id,numero,estado,total,pagado,metodo_pago,fecha_entrega,franja_horaria,modalidad,direccion,tarifa_domicilio,comprobante_url,nota,pedido_items(cantidad,productos(nombre))')
    .eq('chat_telefono', chat).not('estado', 'in', '(entregado,cancelado)').order('creado_en', { ascending: false }).limit(1).maybeSingle()
  return data as any
}
export async function avisar(sb: SupabaseClient, tipo: string, titulo: string, detalle?: string, pedido_id?: string | null, telefono?: string) {
  await sb.from('notificaciones').insert({ tipo, titulo, detalle: detalle ?? null, pedido_id: pedido_id ?? null, telefono: telefono ?? null })
}

export type Ctx = {
  sb: SupabaseClient; cfg: Record<string, string>; telefono: string; prov: Provider
  comprobantePath?: string | null; comprobanteOk?: boolean; referencia?: string | null; humano?: boolean
  fotos?: { link: string; caption: string }[]; pendiente?: string | null; pedidoCreado?: boolean
}

export const TOOLS: Tool[] = [
  { name: 'consultar_catalogo', description: 'Lista los sabores activos con descripción y precio. Con enviar_fotos=true deja listas las fotos para enviarlas en el punto donde escribas [[FOTOS]]; úsalo SOLO si el cliente aceptó que se las envíes.',
    parameters: { type: 'object', properties: { enviar_fotos: { type: 'boolean' } } } },
  { name: 'marcar_pendiente', description: 'Registra qué está esperando el bot del cliente (comprobante de pago, dirección, sabores/cantidad, confirmación del total). Si el cliente no responde, el sistema le enviará un recordatorio.',
    parameters: { type: 'object', properties: { que: { type: 'string', description: 'Qué falta, con detalle (ej. comprobante de $34.000 por Nequi)' } }, required: ['que'] } },
  { name: 'consultar_stock', description: 'Disponibilidad para la próxima fecha de entrega (hoy si es día de producción y hay horario; si no, la siguiente producción): qué sabores hay, cuántas quedan de cada uno, cuáles están agotados y cómo decir la fecha. SIEMPRE úsala antes de ofrecer o confirmar sabores.',
    parameters: { type: 'object', properties: { fecha: { type: 'string', description: 'YYYY-MM-DD opcional' } } } },
  { name: 'consultar_tarifa_domicilio', description: 'Tarifas de domicilio activas.', parameters: { type: 'object', properties: {} } },
  { name: 'registrar_agotado', description: 'Registra que el cliente pidió un sabor sin cupo (demanda insatisfecha).',
    parameters: { type: 'object', properties: { sabor: { type: 'string' }, cantidad: { type: 'integer' }, fecha: { type: 'string' } }, required: ['sabor', 'cantidad'] } },
  { name: 'consultar_medios_pago', description: 'Cuentas y medios de pago disponibles (nombre, número de cuenta, tipo). Úsala cuando el cliente pida un número de cuenta o diga que pagará por Nequi, Bre-B, consignación o transferencia.',
    parameters: { type: 'object', properties: {} } },
  { name: 'modificar_pedido', description: 'Modifica el pedido activo del cliente (método de pago, dirección, franja, nota) mientras el ticket no se haya impreso. Úsala cuando el cliente cambie de opinión después de crear el pedido. No cambia sabores, cantidades ni la fecha.',
    parameters: { type: 'object', properties: { metodo_pago: { type: 'string' }, direccion: { type: 'string' }, ubicacion_compartida: { type: 'boolean' }, franja_horaria: { type: 'string' }, hora_entrega: { type: 'string', description: 'HH:MM en 24 h si el cliente pide otra hora específica' }, nota: { type: 'string' } } } },
  { name: 'avisar_equipo', description: 'Deja un aviso en el micrositio cuando no puedes resolver algo (sin silenciar el chat). Úsala junto con tu respuesta de "eso no te lo puedo confirmar".',
    parameters: { type: 'object', properties: { resumen: { type: 'string', description: 'Qué preguntó o necesita el cliente' }, nombre: { type: 'string' } }, required: ['resumen'] } },
  { name: 'validar_comprobante', description: 'Valida la última imagen de comprobante enviada por el cliente contra el monto a pagar. Si el cliente ya tiene un pedido activo sin pagar, valida contra el total de ese pedido y lo marca como pagado.',
    parameters: { type: 'object', properties: { monto_esperado: { type: 'integer' } }, required: ['monto_esperado'] } },
  { name: 'crear_pedido', description: 'Crea el pedido. Solo con todos los datos completos Y cuando el cliente ya dijo explícitamente cómo va a pagar (nunca asumas el método de pago).',
    parameters: { type: 'object', properties: {
      items: { type: 'array', items: { type: 'object', properties: { sabor: { type: 'string' }, cantidad: { type: 'integer' } }, required: ['sabor', 'cantidad'] } },
      modalidad: { type: 'string', enum: ['domicilio', 'recoger'] }, direccion: { type: 'string' }, zona_tarifa: { type: 'string', description: 'Nombre de la tarifa de domicilio elegida' },
      nombre: { type: 'string' }, telefono_contacto: { type: 'string' }, metodo_pago: { type: 'string' },
      fecha_entrega: { type: 'string', description: 'YYYY-MM-DD' }, franja_horaria: { type: 'string' }, nota: { type: 'string' },
      ubicacion_compartida: { type: 'boolean', description: 'true si la dirección viene de la ubicación (pin) que compartió el cliente' },
      hora_entrega: { type: 'string', description: 'HH:MM en 24 h, solo si el cliente pidió una hora específica de entrega (ej. "a las 3 pm" → 15:00)' },
      direccion_pendiente: { type: 'boolean', description: 'true si es domicilio pero el cliente dice que dará la dirección/ubicación después (cuando vayan a entregar, "te aviso a dónde me lo llevas"). Se reserva igual, sin dirección, con nota de llamarlo para pedirla y aviso al equipo.' },
      pago_pendiente: { type: 'boolean', description: 'true cuando el cliente pagará por transferencia (Nequi, Bre-B…) pero todavía no tiene comprobante (pagará al recibir o después). El pedido se crea reservado, queda como pago pendiente y se avisa al equipo. NO cambies el método a efectivo.' } },
      required: ['items', 'modalidad', 'nombre', 'telefono_contacto', 'metodo_pago', 'fecha_entrega'] } },
  { name: 'notificar_humano', description: 'Escala la conversación a una persona y detiene el bot en este chat. ANTES de llamarla debes tener el nombre completo y el teléfono de contacto del cliente, y saber qué necesita; si falta algo, pídeselo primero.',
    parameters: { type: 'object', properties: {
      nombre: { type: 'string', description: 'Nombre completo del cliente' },
      telefono_contacto: { type: 'string', description: 'Teléfono de contacto del cliente' },
      motivo: { type: 'string', enum: ['pedido_grande_evento', 'personalizacion', 'queja_reclamo', 'otro'] },
      resumen: { type: 'string', description: 'Qué necesita el cliente, con los detalles (cantidades, fecha, sabores, personalización, etc.)' } },
      required: ['nombre', 'telefono_contacto', 'motivo', 'resumen'] } },
]

export async function ejecutar(name: string, a: Record<string, any>, ctx: Ctx): Promise<unknown> {
  const { sb, cfg } = ctx
  const dias = cfg.dias_produccion ?? ''
  const ex = await cargarExcepciones(sb)
  switch (name) {
    case 'consultar_catalogo': {
      const { data } = await sb.from('productos').select('nombre,descripcion,detalles,precio,foto_url').eq('activo', true).order('nombre')
      if (a.enviar_fotos === true)
        ctx.fotos = (data ?? []).filter((p) => p.foto_url).map((p) => ({ link: p.foto_url as string, caption: `${p.nombre} — $${p.precio}` }))
      return (data ?? []).map(({ nombre, descripcion, detalles, precio }) => ({ nombre, descripcion, detalles: detalles || null, precio, nota: 'Solo puedes afirmar lo que dicen descripcion y detalles; si falta un dato, no lo inventes.' }))
    }
    case 'consultar_stock': {
      const hoy = fechaBogota()
      const margen = cfg.anticipacion_minima_min === '' || cfg.anticipacion_minima_min == null ? 60 : Number(cfg.anticipacion_minima_min)
      const cierre = cierreEntregas(cfg.franjas_entrega ?? '')
      const etiqueta = (f: string) => f === hoy ? `hoy${cierre ? ` (entregas hasta las ${cierre.texto})` : ''}` : f === manana(hoy) ? 'mañana' : `el ${fechaLarga(f)}`
      const resumen = async (f: string) => ((await sb.rpc('stock_resumen', { p_fecha: f })).data ?? []) as any[]

      const filasHoy = await resumen(hoy)
      const horneadoHoy = filasHoy.some((r) => r.horneado_registrado)
      const diaProd = esDiaProduccion(hoy, dias, ex)
      const enHorario = !cierre || minutosAhora() < cierre.min - margen
      const puedeHoy = diaProd && horneadoHoy && enHorario
      const motivoNoHoy = puedeHoy ? null
        : !diaProd ? 'hoy no es día de producción'
        : !enHorario ? `ya pasó el límite para pedidos de hoy (se toman hasta ${margen} min antes del cierre de entregas)`
        : 'aún no se ha registrado el horneado de hoy'
      const proxima = proximaProduccion(hoy, dias, false, ex)
      const pedida: string | undefined = a.fecha
      let modoHoy = pedida ? pedida === hoy : puedeHoy
      const extrasHoy = filasHoy.filter((r) => r.activo).reduce((t, r) => t + Number(r.extras_dia), 0)
      // Si hoy ya no queda ningún extra, se pasa directo a agendar para la siguiente fecha de entrega
      const hoySeAcaboTodo = !pedida && puedeHoy && extrasHoy === 0
      if (hoySeAcaboTodo) modoHoy = false
      const fecha = pedida ?? (modoHoy ? hoy : proxima)
      if (!fecha) return { error: 'No hay días de producción configurados' }
      const filas = fecha === hoy ? filasHoy : await resumen(fecha)
      // Fecha futura = día de producción: se hornea de nuevo, así que (si las reservas lo permiten) todos los sabores se ofrecen aunque el stock registrado sea 0
      const seProduce = !modoHoy && cfg.permitir_reserva_sin_stock !== 'no'
      const sabores = filas.filter((r) => r.activo).map((r) => {
        const cant = modoHoy ? Number(r.extras_dia) : Number(r.disponible_general)
        return { sabor: r.nombre as string, disponible: cant > 0 || seProduce, cantidad_disponible: cant, ...(seProduce && cant <= 0 ? { se_produce_para_esa_fecha: true } : {}) }
      })
      const faltantes = sabores.filter((x) => !x.disponible).map((x) => x.sabor)
      let agendables: unknown = null
      let sinStock: string[] = []
      if (modoHoy && faltantes.length && proxima) {
        // Lo que ya no queda hoy se puede agendar para la siguiente fecha si hay stock general
        const gen = await resumen(proxima)
        const con = gen.filter((r) => faltantes.includes(r.nombre) && Number(r.disponible_general) > 0)
        agendables = { fecha: proxima, cuando_decirlo: etiqueta(proxima), sabores: con.map((r) => ({ sabor: r.nombre, cantidad_disponible: Number(r.disponible_general) })) }
        sinStock = faltantes.filter((n) => !con.some((r) => r.nombre === n))
      } else if (!modoHoy) sinStock = faltantes
      return {
        hoy: `${diaSemana(hoy)} ${hoy}`, modo: modoHoy ? 'mismo_dia' : 'agendar', fecha_entrega: fecha, cuando_decirlo: etiqueta(fecha),
        hoy_ya_se_acabo_todo: hoySeAcaboTodo,
        motivo_no_es_hoy: modoHoy ? null : (hoySeAcaboTodo ? 'hoy ya se acabaron todas las galletas' : motivoNoHoy), franjas_entrega: cfg.franjas_entrega,
        sabores_disponibles_para_esa_fecha: sabores.filter((x) => x.disponible),
        sabores_que_no_alcanzan_para_esa_fecha: faltantes,
        de_esos_se_pueden_agendar_para_la_siguiente_fecha: agendables, sin_stock_por_ahora: sinStock,
        proxima_produccion: (modoHoy ? proxima : fecha) ? { fecha: modoHoy ? proxima : fecha, cuando_decirlo: etiqueta((modoHoy ? proxima : fecha) as string) } : null,
        reserva_sin_stock_permitida: cfg.permitir_reserva_sin_stock !== 'no',
        nota: 'Si modo=agendar, esa fecha es un día de producción: se hornea de nuevo, así que ofrece TODOS los sabores de sabores_disponibles_para_esa_fecha como disponibles para esa fecha (aunque cantidad_disponible sea 0) y NUNCA digas que no hay sabores ni que "no quedan". No ofrezcas "avisarle cuando haya": ofrece reservar. Si el cliente quiere un sabor que está en sin_stock_por_ahora NO pierdas la venta: dile que se producirán más para proxima_produccion y ofrécele dejárselo reservado (si reserva_sin_stock_permitida) o avisarle; llama registrar_agotado. Usa cantidad_disponible si preguntan cuántas quedan. Un pedido nunca supera esas cantidades. Habla de forma natural ("ya se acabó por hoy"), nunca listes sabores con la palabra "agotado".',
      }
    }
    case 'consultar_tarifa_domicilio': {
      const { data } = await sb.from('tarifas_domicilio').select('nombre,valor').eq('activo', true)
      return data
    }
    case 'registrar_agotado': {
      const { data: p } = await sb.from('productos').select('id').ilike('nombre', `%${a.sabor}%`).limit(1).maybeSingle()
      await sb.from('demanda_insatisfecha').insert({ fecha: a.fecha ?? fechaBogota(), producto_id: p?.id ?? null, cantidad: a.cantidad ?? 1, telefono: ctx.telefono })
      // Avisa al admin (una vez por cliente y sabor cada 12 h) para que sepa que hay demanda sin stock
      const titulo = `Cliente pidió sin stock: ${a.cantidad ?? 1} × ${a.sabor}`
      const { count } = await sb.from('notificaciones').select('id', { count: 'exact', head: true }).eq('telefono', ctx.telefono).eq('titulo', titulo)
        .gte('creado_en', new Date(Date.now() - 12 * 3600 * 1000).toISOString())
      if (!count) await avisar(sb, 'sin_stock', titulo, 'El bot le informó que se producirán más y le ofreció reservar/avisarle.', null, ctx.telefono)
      return { ok: true }
    }
    case 'consultar_medios_pago': {
      const m = await metodosDisponibles(sb, cfg)
      return { medios: m.medios, efectivo_contraentrega: m.efectivo,
        nota: 'Estos son los ÚNICOS medios de pago disponibles: no menciones ni inventes otros. Si el cliente pide el número de cuenta, envía todos los medios con el valor exacto a pagar, sin preguntarle primero por cuál.' }
    }
    case 'validar_comprobante': {
      if (!ctx.comprobantePath) return { ok: false, motivo: 'El cliente aún no envió imagen de comprobante' }
      const activo = await pedidoActivo(sb, ctx.telefono)
      const pendientePago = activo && !activo.pagado
      const esperado = pendientePago ? activo.total : a.monto_esperado
      const fallar = async (motivo: string) => {
        if (activo) await sb.from('pedidos').update({ comprobante_url: ctx.comprobantePath }).eq('id', activo.id)
        await avisar(sb, 'pago_revision', activo ? `Comprobante por revisar — pedido #${activo.numero}` : 'Comprobante por revisar (aún sin pedido)', motivo, activo?.id, ctx.telefono)
        return { ok: false, motivo }
      }
      const { data: file } = await sb.storage.from('comprobantes').download(ctx.comprobantePath)
      if (!file) return { ok: false, motivo: 'No se pudo abrir la imagen' }
      const r = await leerComprobante(ctx.prov, new Uint8Array(await file.arrayBuffer()), file.type || 'image/jpeg')
      if (!r.legible || r.monto == null) return await fallar('Imagen ilegible o sin monto; pide otra foto (ya se avisó al equipo para revisión manual)')
      if (r.monto !== esperado) return await fallar(`El monto del comprobante (${r.monto}) no coincide con ${esperado}; revisión manual`)
      if (r.referencia) {
        const { count } = await sb.from('pedidos').select('id', { count: 'exact', head: true }).eq('referencia_pago', r.referencia)
        if (count) return await fallar('Esa referencia de pago ya fue usada en otro pedido')
      }
      ctx.comprobanteOk = true; ctx.referencia = r.referencia
      if (activo) {
        await sb.from('pedidos').update({ pagado: true, estado: ANTES_DE_IMPRIMIR.includes(activo.estado) ? 'pago_verificado' : activo.estado,
          comprobante_url: ctx.comprobantePath, referencia_pago: r.referencia }).eq('id', activo.id)
        await avisar(sb, 'pago', `Pago recibido — pedido #${activo.numero}`, `$${r.monto}${r.referencia ? ' · ref ' + r.referencia : ''} (validado automáticamente)`, activo.id, ctx.telefono)
        ctx.pendiente = null
      }
      return { ok: true, monto: r.monto, referencia: r.referencia }
    }
    case 'modificar_pedido': {
      const p = await pedidoActivo(sb, ctx.telefono)
      if (!p) return { ok: false, error: 'No hay un pedido activo de este cliente' }
      if (!ANTES_DE_IMPRIMIR.includes(p.estado))
        return { ok: false, error: 'El ticket ya se imprimió o el pedido va en camino: no se puede modificar desde aquí. Usa avisar_equipo y dile al cliente que alguien del equipo lo contacta.' }
      const cambios: Record<string, unknown> = {}; const notas: string[] = []
      if (a.metodo_pago && sinAcento(a.metodo_pago) !== sinAcento(p.metodo_pago ?? '')) {
        const disp = await metodosDisponibles(sb, cfg)
        if (!metodoValido(a.metodo_pago, disp)) return { ok: false, error: `Método de pago no disponible. Solo: ${listaMetodos(disp)}` }
        const efectivo = sinAcento(a.metodo_pago).includes('efectivo')
        cambios.metodo_pago = a.metodo_pago
        if (efectivo) { cambios.estado = 'pendiente_cobro'; cambios.pagado = false }
        else if (!p.pagado) { cambios.estado = 'recibido'; cambios.pagado = false }
        notas.push(`Pago: ${p.metodo_pago} → ${a.metodo_pago}`)
      }
      if (a.direccion) {
        cambios.direccion = a.direccion; notas.push('Dirección actualizada')
        if (a.ubicacion_compartida) {
          const { data: cv } = await sb.from('conversaciones').select('ultima_lat,ultima_lng').eq('telefono', ctx.telefono).maybeSingle()
          Object.assign(cambios, { direccion_aprox: true, lat: cv?.ultima_lat ?? null, lng: cv?.ultima_lng ?? null })
        }
      }
      if (a.franja_horaria) { cambios.franja_horaria = a.franja_horaria; notas.push(`Franja: ${a.franja_horaria}`) }
      if (a.hora_entrega) {
        const h = normalizarHora(a.hora_entrega)
        if (!h) return { ok: false, error: 'hora_entrega debe tener formato HH:MM' }
        cambios.hora_entrega_solicitada = h; notas.push(`Hora pedida: ${h}`)
      }
      if (a.nota) { cambios.nota = [p.nota, a.nota].filter(Boolean).join(' | '); notas.push('Nota agregada') }
      if (!Object.keys(cambios).length) return { ok: false, error: 'No hay cambios que aplicar' }
      await sb.from('pedidos').update(cambios).eq('id', p.id)
      await avisar(sb, 'cambio', `Pedido #${p.numero} modificado por el cliente`, notas.join(' · '), p.id, ctx.telefono)
      const requierePago = cambios.estado === 'recibido'
      if (requierePago) ctx.pendiente = `comprobante de pago de $${p.total} del pedido #${p.numero}`
      return { ok: true, pedido: p.numero, total: p.total, cobrar_en_entrega: cambios.estado === 'pendiente_cobro' ? p.total : 0,
        siguiente: requierePago ? 'Envía los medios de pago (consultar_medios_pago) con el valor exacto y pide el comprobante; cuando llegue, valídalo con validar_comprobante.' : 'Confirma el cambio al cliente.' }
    }
    case 'avisar_equipo': {
      await avisar(sb, 'sin_respuesta', `El bot no pudo resolver: ${String(a.resumen ?? '').slice(0, 80)}`, `${a.nombre ? a.nombre + ' · ' : ''}${a.resumen}`, null, ctx.telefono)
      return { ok: true, instruccion: 'Dile al cliente que no puedes confirmarlo y que alguien del equipo le escribirá; si hay número de atención personalizada, ofrécelo.' }
    }
    case 'marcar_pendiente': ctx.pendiente = String(a.que ?? '').slice(0, 300); return { ok: true }
    case 'crear_pedido': {
      const r = await crearPedido(a, ctx) as { ok?: boolean }
      if (r.ok) { ctx.pedidoCreado = true; ctx.pendiente = null }
      return r
    }
    case 'notificar_humano': {
      if (!a.nombre?.trim() || !a.telefono_contacto?.trim() || !a.resumen?.trim())
        return { ok: false, error: 'Faltan datos: pide al cliente su nombre completo, teléfono de contacto y qué necesita, y vuelve a llamar.' }
      await sb.from('conversaciones').upsert({ telefono: ctx.telefono, humano: true, humano_desde: new Date().toISOString(), actualizado_en: new Date().toISOString() })
      ctx.humano = true
      await avisar(sb, a.motivo === 'pedido_grande_evento' ? 'pedido_grande' : 'atencion', `Atención humana: ${a.nombre}`, `${a.telefono_contacto} · ${a.motivo}: ${a.resumen}`, null, ctx.telefono)
      const motivos: Record<string, string> = { pedido_grande_evento: 'Pedido grande o evento', personalizacion: 'Personalización',
        queja_reclamo: 'Queja o reclamo', otro: 'Otro' }
      const motivo = motivos[a.motivo] ?? 'Otro'
      for (const n of (cfg.admin_numeros ?? '').split(',').map((s) => s.replace(/\D/g, '')).filter(Boolean))
        await notify(n, { templateEnv: 'WA_TEMPLATE_ADMIN', params: [a.nombre, a.telefono_contacto, motivo, a.resumen],
          text: `⚠️ Atención humana requerida\nCliente: ${a.nombre}\nTeléfono: ${a.telefono_contacto}\nMotivo: ${motivo}\nDetalle: ${a.resumen}\nChat: ${ctx.telefono}\n\nEl bot se reactiva solo en ${cfg.horas_humano || 12} h. Antes: reanudar ${ctx.telefono}` })
      return { ok: true, instruccion: 'Avisa al cliente que en un momento le escribe alguien del equipo. No sigas respondiendo.' }
    }
  }
  return { error: 'herramienta desconocida' }
}

async function crearPedido(a: Record<string, any>, ctx: Ctx) {
  const { sb, cfg } = ctx
  const hoy = fechaBogota()
  const fecha: string = a.fecha_entrega
  if (fecha < hoy) return { ok: false, error: 'Fecha en el pasado' }
  const ex = await cargarExcepciones(sb)
  if (!esDiaProduccion(fecha, cfg.dias_produccion ?? '', ex)) {
    const cerrado = ex.get(fecha)
    return { ok: false, error: cerrado?.tipo === 'cerrado' ? `Ese día no hay producción ni entregas${cerrado.nota ? ` (${cerrado.nota})` : ''}. Ofrece la siguiente fecha de producción (consultar_stock).` : 'Esa fecha no es día de producción' }
  }
  const cierre = cierreEntregas(cfg.franjas_entrega ?? '')
  const margen = cfg.anticipacion_minima_min === '' || cfg.anticipacion_minima_min == null ? 60 : Number(cfg.anticipacion_minima_min)
  if (fecha === hoy && cierre && minutosAhora() >= cierre.min - margen)
    return { ok: false, error: `Ya no se toman pedidos para hoy (hasta ${margen} min antes del cierre de entregas); ofrece la próxima fecha de entrega` }

  // Pedidos grandes se consultan con el admin
  const unidades = (a.items ?? []).reduce((t: number, i: any) => t + (Number(i.cantidad) || 0), 0)
  const umbral = Number(cfg.umbral_pedido_grande) > 0 ? Number(cfg.umbral_pedido_grande) : 30
  if (unidades >= umbral) return { ok: false, requiere_admin: true, error: `Pedidos de ${umbral} o más galletas los define el equipo: pide nombre, teléfono y detalle del pedido, usa notificar_humano (motivo pedido_grande_evento) y no crees el pedido.` }
  // El método debe ser uno de los configurados y el cliente debe haberlo dicho (nunca asumirlo)
  const disp = await metodosDisponibles(sb, cfg)
  if (!metodoValido(a.metodo_pago, disp)) return { ok: false, error: `Método de pago no disponible. Ofrece solo: ${listaMetodos(disp)}` }
  const payRe = new RegExp([...PAGO_BASE, ...disp.medios.map((x) => escRe(sinAcento(x.nombre)))].join('|'), 'i')
  const { data: dichos } = await sb.from('mensajes').select('contenido').eq('telefono', ctx.telefono).eq('rol', 'user').order('creado_en', { ascending: false }).limit(12)
  if (!(dichos ?? []).some((m: any) => payRe.test(sinAcento(m.contenido))))
    return { ok: false, error: `El cliente todavía no ha dicho cómo va a pagar. Pregúntale ofreciendo solo: ${listaMetodos(disp)}; no asumas ninguno.` }
  const horaPedida = a.hora_entrega ? normalizarHora(a.hora_entrega) : null
  if (a.hora_entrega && !horaPedida) return { ok: false, error: 'hora_entrega debe tener formato HH:MM' }
  if (fecha === hoy && horaPedida) {
    const [hh, mm] = horaPedida.split(':').map(Number)
    if (hh * 60 + mm < minutosAhora() + margen) return { ok: false, error: `Esa hora ya no alcanza: se necesitan al menos ${margen} min de anticipación. Ofrece otra hora o agendar para la siguiente fecha.` }
  }

  const items: { producto_id: string; cantidad: number; precio: number; nombre: string }[] = []
  for (const it of a.items) {
    const { data: p } = await sb.from('productos').select('id,nombre,precio').eq('activo', true).ilike('nombre', `%${it.sabor}%`).limit(1).maybeSingle()
    if (!p) return { ok: false, error: `Sabor no encontrado: ${it.sabor}` }
    items.push({ producto_id: p.id, cantidad: it.cantidad, precio: p.precio, nombre: p.nombre })
  }
  let tarifa = 0
  if (a.modalidad === 'domicilio') {
    const { data: t } = await sb.from('tarifas_domicilio').select('nombre,valor').eq('activo', true)
    const hit = (t ?? []).find((x: any) => a.zona_tarifa && sinAcento(x.nombre).includes(sinAcento(a.zona_tarifa))) ?? ((t ?? []).length === 1 ? t![0] : null)
    if (!hit) return { ok: false, error: 'Indica zona_tarifa válida (consultar_tarifa_domicilio)' }
    tarifa = hit.valor
    if (!a.direccion && a.direccion_pendiente !== true) return { ok: false, error: 'Falta la dirección. Si el cliente dice que la dará después (cuando vayan a entregar), usa direccion_pendiente=true.' }
  }
  // Stock: mismo día = extras horneados; fechas futuras = stock general (fabricado menos lo ya agendado)
  const pedidas = new Map<string, number>()
  items.forEach((i) => pedidas.set(i.producto_id, (pedidas.get(i.producto_id) ?? 0) + i.cantidad))
  const filas = ((await sb.rpc('stock_resumen', { p_fecha: fecha })).data ?? []) as any[]
  const permitirReserva = cfg.permitir_reserva_sin_stock !== 'no' && fecha > hoy
  const faltas: string[] = []
  for (const [pid, cant] of pedidas) {
    const r = filas.find((x) => x.producto_id === pid)
    const disponibles = fecha === hoy ? (r?.horneado_registrado ? Number(r.extras_dia) : 0) : Number(r?.disponible_general ?? 0)
    if (cant > disponibles) {
      const nombre = items.find((i) => i.producto_id === pid)!.nombre
      await sb.from('demanda_insatisfecha').insert({ fecha, producto_id: pid, cantidad: cant - disponibles, telefono: ctx.telefono })
      if (!permitirReserva)
        return { ok: false, sin_stock: true, sabor: nombre, disponibles, error: `Solo ${disponibles === 0 ? 'no quedan' : 'quedan ' + disponibles} de ${nombre} ${fecha === hoy ? 'para hoy' : 'disponibles para agendar'}. Ofrece lo que hay o consulta la siguiente fecha con consultar_stock.` }
      faltas.push(`${cant - disponibles} × ${nombre}`)
    }
  }
  const total = items.reduce((s, i) => s + i.precio * i.cantidad, 0) + tarifa
  const efectivo = sinAcento(a.metodo_pago).includes('efectivo')
  const pagoOk = !efectivo && ctx.comprobanteOk === true
  const pendiente = !efectivo && !pagoOk && a.pago_pendiente === true
  const sinDir = a.modalidad === 'domicilio' && !a.direccion
  if (!efectivo && !pagoOk && !pendiente) {
    return { ok: false, error: 'Pago no verificado: usa validar_comprobante primero. Si el cliente dice que pagará después o al recibir, vuelve a llamar con pago_pendiente=true (sin cambiar el método de pago).' }
  }
  let ubic: { lat?: number | null; lng?: number | null } = {}
  if (a.ubicacion_compartida) {
    const { data: cv } = await sb.from('conversaciones').select('ultima_lat,ultima_lng').eq('telefono', ctx.telefono).maybeSingle()
    ubic = { lat: cv?.ultima_lat, lng: cv?.ultima_lng }
  }
  const { data: ped, error } = await sb.from('pedidos').insert({
    chat_telefono: ctx.telefono, pendiente_produccion: faltas.length > 0, hora_entrega_solicitada: horaPedida, direccion_aprox: !!a.ubicacion_compartida, lat: ubic.lat ?? null, lng: ubic.lng ?? null,
    cliente_nombre: a.nombre, cliente_telefono: a.telefono_contacto, origen: 'bot', metodo_pago: a.metodo_pago,
    estado: efectivo ? 'pendiente_cobro' : pendiente ? 'recibido' : 'pago_verificado', pagado: pagoOk, modalidad: a.modalidad, direccion: a.direccion ?? null,
    tarifa_domicilio: tarifa, total, nota: sinDir ? [a.nota, '📞 LLAMAR al cliente para pedir la dirección/ubicación de entrega'].filter(Boolean).join(' · ') : (a.nota ?? null), fecha_entrega: fecha, franja_horaria: a.franja_horaria ?? null,
    comprobante_url: pagoOk ? ctx.comprobantePath : null, referencia_pago: pagoOk ? ctx.referencia : null,
  }).select('id,numero').single()
  if (error || !ped) return { ok: false, error: error?.message }
  if (faltas.length) await avisar(sb, 'sin_stock', `Reserva sin stock — pedido #${ped.numero}`, `Faltan por producir para ${fecha}: ${faltas.join(', ')}`, ped.id, ctx.telefono)
  if (sinDir) await avisar(sb, 'atencion', `Falta la dirección — pedido #${ped.numero}`, `El cliente dará la ubicación al momento de la entrega: llámalo para pedirla (${a.telefono_contacto}).`, ped.id, ctx.telefono)
  if (pendiente) await avisar(sb, 'pago', `Pago pendiente — pedido #${ped.numero}`, `$${total} por ${a.metodo_pago}: el cliente pagará después o al recibir. Verifica el pago cuando llegue (Confirmar pago en Pedidos).`, ped.id, ctx.telefono)
  if (pagoOk) await avisar(sb, 'pago', `Pago recibido — pedido #${ped.numero}`, `$${total} (validado automáticamente)`, ped.id, ctx.telefono)
  await sb.from('pedido_items').insert(items.map((i) => ({ pedido_id: ped.id, producto_id: i.producto_id, cantidad: i.cantidad, precio_unitario: i.precio })))
  return { ok: true, numero_pedido: ped.numero, total, ...(sinDir ? { direccion_pendiente: true, aviso_direccion: 'Queda reservado sin dirección; dile que lo llamamos para que nos indique dónde entregarlo.' } : {}), cobrar_en_entrega: efectivo ? total : 0, ...(pendiente ? { pago_pendiente_por: a.metodo_pago, aviso_pago: `Queda reservado con pago pendiente por ${a.metodo_pago}; el equipo ya fue avisado. Dile que pagará por ${a.metodo_pago} y que le confirmamos al recibir el pago.` } : {}), fecha_entrega: fecha,
    ...(faltas.length ? { pendiente_de_produccion: true, aviso: 'Parte del pedido se producirá para esa fecha: díselo con naturalidad (queda reservado y el equipo lo fabrica).' } : {}) }
}
