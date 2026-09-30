import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { Tool, Provider } from './ai.ts'
import { leerComprobante } from './ai.ts'
import { notify, sendImage } from './wa.ts'

export const TZ = 'America/Bogota'
export const fechaBogota = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
const sinAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export const diaSemana = (fecha: string) => DIAS[new Date(fecha + 'T12:00:00Z').getUTCDay()]

export function esDiaProduccion(fecha: string, dias: string) {
  return dias.split(',').map((d) => sinAcento(d.trim())).includes(diaSemana(fecha))
}
export function proximaProduccion(desde: string, dias: string, incluirHoy: boolean) {
  const d = new Date(desde + 'T12:00:00Z')
  for (let i = incluirHoy ? 0 : 1; i < 15; i++) {
    const c = new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10)
    if (esDiaProduccion(c, dias)) return c
  }
  return null
}

export type Ctx = {
  sb: SupabaseClient; cfg: Record<string, string>; telefono: string; prov: Provider
  comprobantePath?: string | null; comprobanteOk?: boolean; referencia?: string | null; humano?: boolean
}

export const TOOLS: Tool[] = [
  { name: 'consultar_catalogo', description: 'Lista los sabores activos con descripción y precio, y envía sus fotos al cliente por WhatsApp.',
    parameters: { type: 'object', properties: { enviar_fotos: { type: 'boolean' } } } },
  { name: 'consultar_stock', description: 'Stock disponible: cupo de hoy (solo si hoy es día de producción) y próximo día de producción.',
    parameters: { type: 'object', properties: { fecha: { type: 'string', description: 'YYYY-MM-DD opcional' } } } },
  { name: 'consultar_tarifa_domicilio', description: 'Tarifas de domicilio activas.', parameters: { type: 'object', properties: {} } },
  { name: 'registrar_agotado', description: 'Registra que el cliente pidió un sabor sin cupo (demanda insatisfecha).',
    parameters: { type: 'object', properties: { sabor: { type: 'string' }, cantidad: { type: 'integer' }, fecha: { type: 'string' } }, required: ['sabor', 'cantidad'] } },
  { name: 'validar_comprobante', description: 'Valida la última imagen de comprobante enviada por el cliente contra el monto a pagar.',
    parameters: { type: 'object', properties: { monto_esperado: { type: 'integer' } }, required: ['monto_esperado'] } },
  { name: 'crear_pedido', description: 'Crea el pedido. Solo con todos los datos completos.',
    parameters: { type: 'object', properties: {
      items: { type: 'array', items: { type: 'object', properties: { sabor: { type: 'string' }, cantidad: { type: 'integer' } }, required: ['sabor', 'cantidad'] } },
      modalidad: { type: 'string', enum: ['domicilio', 'recoger'] }, direccion: { type: 'string' }, zona_tarifa: { type: 'string', description: 'Nombre de la tarifa de domicilio elegida' },
      nombre: { type: 'string' }, telefono_contacto: { type: 'string' }, metodo_pago: { type: 'string' },
      fecha_entrega: { type: 'string', description: 'YYYY-MM-DD' }, franja_horaria: { type: 'string' }, nota: { type: 'string' } },
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
  switch (name) {
    case 'consultar_catalogo': {
      const { data } = await sb.from('productos').select('nombre,descripcion,precio,foto_url').eq('activo', true).order('nombre')
      if (a.enviar_fotos !== false)
        for (const p of data ?? []) if (p.foto_url) await sendImage(ctx.telefono, p.foto_url, `${p.nombre} — $${p.precio}`)
      return (data ?? []).map(({ nombre, descripcion, precio }) => ({ nombre, descripcion, precio }))
    }
    case 'consultar_stock': {
      const hoy = fechaBogota()
      const fecha = a.fecha ?? hoy
      const { data } = await sb.from('stock_dia').select('cantidad_excedente,productos(nombre)').eq('fecha', fecha)
      const proxima = proximaProduccion(hoy, dias, false)
      return {
        hoy, dia_hoy: diaSemana(hoy), hoy_es_dia_de_produccion: esDiaProduccion(hoy, dias),
        franjas_entrega: cfg.franjas_entrega, proximo_dia_produccion: proxima, dia_semana_proximo: proxima ? diaSemana(proxima) : null,
        fecha_consultada: fecha,
        cupo_libre: esDiaProduccion(fecha, dias) || fecha > hoy
          ? (data ?? []).map((r: any) => ({ sabor: r.productos?.nombre, disponibles: r.cantidad_excedente })) : [],
      }
    }
    case 'consultar_tarifa_domicilio': {
      const { data } = await sb.from('tarifas_domicilio').select('nombre,valor').eq('activo', true)
      return data
    }
    case 'registrar_agotado': {
      const { data: p } = await sb.from('productos').select('id').ilike('nombre', `%${a.sabor}%`).limit(1).maybeSingle()
      await sb.from('demanda_insatisfecha').insert({ fecha: a.fecha ?? fechaBogota(), producto_id: p?.id ?? null, cantidad: a.cantidad ?? 1, telefono: ctx.telefono })
      return { ok: true }
    }
    case 'validar_comprobante': {
      if (!ctx.comprobantePath) return { ok: false, motivo: 'El cliente aún no envió imagen de comprobante' }
      const { data: file } = await sb.storage.from('comprobantes').download(ctx.comprobantePath)
      if (!file) return { ok: false, motivo: 'No se pudo abrir la imagen' }
      const r = await leerComprobante(ctx.prov, new Uint8Array(await file.arrayBuffer()), file.type || 'image/jpeg')
      if (!r.legible || r.monto == null) return { ok: false, motivo: 'Imagen ilegible o sin monto; pedir otra foto' }
      if (r.monto !== a.monto_esperado) return { ok: false, motivo: `El monto del comprobante (${r.monto}) no coincide con ${a.monto_esperado}` }
      if (r.referencia) {
        const { count } = await sb.from('pedidos').select('id', { count: 'exact', head: true }).eq('referencia_pago', r.referencia)
        if (count) return { ok: false, motivo: 'Esa referencia de pago ya fue usada en otro pedido' }
      }
      ctx.comprobanteOk = true; ctx.referencia = r.referencia
      return { ok: true, monto: r.monto, referencia: r.referencia }
    }
    case 'crear_pedido': return await crearPedido(a, ctx)
    case 'notificar_humano': {
      if (!a.nombre?.trim() || !a.telefono_contacto?.trim() || !a.resumen?.trim())
        return { ok: false, error: 'Faltan datos: pide al cliente su nombre completo, teléfono de contacto y qué necesita, y vuelve a llamar.' }
      await sb.from('conversaciones').upsert({ telefono: ctx.telefono, humano: true, actualizado_en: new Date().toISOString() })
      ctx.humano = true
      const motivos: Record<string, string> = { pedido_grande_evento: 'Pedido grande o evento', personalizacion: 'Personalización',
        queja_reclamo: 'Queja o reclamo', otro: 'Otro' }
      const motivo = motivos[a.motivo] ?? 'Otro'
      for (const n of (cfg.admin_numeros ?? '').split(',').map((s) => s.replace(/\D/g, '')).filter(Boolean))
        await notify(n, { templateEnv: 'WA_TEMPLATE_ADMIN', params: [a.nombre, a.telefono_contacto, motivo, a.resumen, ctx.telefono],
          text: `⚠️ Atención humana requerida\nCliente: ${a.nombre}\nTeléfono: ${a.telefono_contacto}\nMotivo: ${motivo}\nDetalle: ${a.resumen}\nChat: ${ctx.telefono}\n\nPara reactivar el bot: reanudar ${ctx.telefono}` })
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
  if (!esDiaProduccion(fecha, cfg.dias_produccion ?? '')) return { ok: false, error: 'Esa fecha no es día de producción' }

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
    if (!a.direccion) return { ok: false, error: 'Falta la dirección' }
  }
  const reservados: typeof items = []
  for (const it of items) {
    const { data: ok } = await sb.rpc('reservar_stock', { p_fecha: fecha, p_producto: it.producto_id, p_cantidad: it.cantidad })
    if (!ok) {
      for (const r of reservados) await sb.rpc('liberar_stock', { p_fecha: fecha, p_producto: r.producto_id, p_cantidad: r.cantidad })
      await sb.from('demanda_insatisfecha').insert({ fecha, producto_id: it.producto_id, cantidad: it.cantidad, telefono: ctx.telefono })
      return { ok: false, error: `Sin cupo suficiente de ${it.nombre} para ${fecha}` }
    }
    reservados.push(it)
  }
  const total = items.reduce((s, i) => s + i.precio * i.cantidad, 0) + tarifa
  const efectivo = sinAcento(a.metodo_pago).includes('efectivo')
  const pagoOk = !efectivo && ctx.comprobanteOk === true
  if (!efectivo && !pagoOk) {
    for (const r of reservados) await sb.rpc('liberar_stock', { p_fecha: fecha, p_producto: r.producto_id, p_cantidad: r.cantidad })
    return { ok: false, error: 'Pago no verificado: usa validar_comprobante primero' }
  }
  const { data: ped, error } = await sb.from('pedidos').insert({
    cliente_nombre: a.nombre, cliente_telefono: a.telefono_contacto, origen: 'bot', metodo_pago: a.metodo_pago,
    estado: efectivo ? 'pendiente_cobro' : 'pago_verificado', pagado: pagoOk, modalidad: a.modalidad, direccion: a.direccion ?? null,
    tarifa_domicilio: tarifa, total, nota: a.nota ?? null, fecha_entrega: fecha, franja_horaria: a.franja_horaria ?? null,
    comprobante_url: pagoOk ? ctx.comprobantePath : null, referencia_pago: pagoOk ? ctx.referencia : null,
  }).select('id,numero').single()
  if (error || !ped) {
    for (const r of reservados) await sb.rpc('liberar_stock', { p_fecha: fecha, p_producto: r.producto_id, p_cantidad: r.cantidad })
    return { ok: false, error: error?.message }
  }
  await sb.from('pedido_items').insert(items.map((i) => ({ pedido_id: ped.id, producto_id: i.producto_id, cantidad: i.cantidad, precio_unitario: i.precio })))
  return { ok: true, numero_pedido: ped.numero, total, cobrar_en_entrega: efectivo ? total : 0, fecha_entrega: fecha }
}
