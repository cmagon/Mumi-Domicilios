// Asistente del administrador: el número admin NUNCA se trata como cliente. Si no es un comando, aquí se interpreta (texto o nota de voz):
// crear un pedido a nombre de otra persona ("pedido para Juan, 3 de maracuyá…"), confirmarlo y registrarlo. Todo lo demás recibe la ayuda de comandos.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { chat } from './ai.ts'
import { construirProveedor } from './config.ts'
import { sendText } from './wa.ts'
import { barrioSinDomicilio, cargarExcepciones, esDiaProduccion, fechaBogota } from './tools.ts'
import { horaHablada } from './texto.ts'
import { conversarEquipo } from './equipo.ts'
import { ejecutarCancelacion, reporteDia, vistaCancelacion } from './adminresumen.ts'

const AYUDA = `Estás en modo administrador 👩‍🍳 (no te trato como cliente). Puedes escribirme o mandarme una nota de voz:
• Crear un pedido: "pedido para Juan Pérez, 3001234567, 3 de maracuyá y 2 de cacao, mañana, domicilio en calle 20 #22-10, paga en efectivo"
• "dame un reporte de hoy" (pedidos, clientes, ventas, galletas)
• "voy a cancelar los pedidos de hoy porque …" (aviso a cada cliente)
• evento: … · instrucción: … · avisos · quitar aviso N
• hoy: cacao 30, limón 20 · fabricadas: cacao 40
• Foto o video con el pie "foto: Cacao" o "nuevo: Nombre, precio, descripción"
• reanudar 57300… (devuelve un chat al bot)`

const SISTEMA = `Eres el asistente del administrador de Mumi (galletas por WhatsApp). El administrador te dicta (a veces por voz, con errores de transcripción) algo. Decide qué quiere: CREAR UN PEDIDO para otra persona (extrae los datos usando SOLO lo que dijo), pedir un REPORTE (cuántos clientes, pedidos, ventas, galletas… de un día), CANCELAR LOS PEDIDOS de un día avisando a los clientes ("voy a cancelar los pedidos de hoy porque no puedo…"), u otra cosa. Responde SOLO un JSON:
{"intencion":"pedido"|"reporte"|"cancelar_dia"|"otro","fecha_reporte":"YYYY-MM-DD"|null (para reporte o cancelar_dia; por defecto hoy),"motivo":"razón breve y amable para decirle a los clientes, sin datos internos"|null,"nombre":string|null,"telefono":string|null,"items":[{"sabor":"nombre EXACTO de la lista","cantidad":número}],"modalidad":"domicilio"|"recoger"|null,"direccion":string|null,"zona_tarifa":"nombre EXACTO de la lista de tarifas"|null,"metodo_pago":"nombre EXACTO de la lista"|"Efectivo"|null,"pagado":true|false,"fecha_entrega":"YYYY-MM-DD"|null,"hora_entrega":"HH:MM"|null,"franja":string|null,"nota":string|null,"avisar_cliente":true|false,"completo":true|false,"pregunta":"UNA pregunta corta con TODO lo que falta"|null}
Obligatorios para completo=true: nombre, items, fecha_entrega, modalidad y metodo_pago; si es domicilio también zona_tarifa (si hay una sola tarifa úsala). El teléfono es opcional (sin teléfono no se avisa al cliente). Si falta la dirección en un domicilio, completo=true igual (queda "llamar para pedir la dirección"). Interpreta fechas relativas con la fecha de hoy. "pagado" solo si dijo que ya pagó. "avisar_cliente" true si pidió avisarle.`

type Datos = Record<string, any>
const fmt$ = (n: number) => '$' + n.toLocaleString('es-CO')

async function parsear(sb: SupabaseClient, cfg: Record<string, string>, crudo: string): Promise<Datos> {
  const [{ data: prods }, { data: tars }, { data: mets }] = await Promise.all([
    sb.from('productos').select('nombre').eq('activo', true), sb.from('tarifas_domicilio').select('nombre,valor').eq('activo', true), sb.from('metodos_pago').select('nombre').eq('activo', true)])
  const hoy = fechaBogota()
  const prov = await construirProveedor(sb, cfg)
  const out = await chat(prov, SISTEMA, [{ role: 'user', content: `Hoy es ${hoy} (${new Date(hoy + 'T12:00:00Z').toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'UTC' })}).\nSabores: ${(prods ?? []).map((x) => x.nombre).join(', ')}\nTarifas de domicilio: ${(tars ?? []).map((x) => x.nombre).join(', ')}\nMétodos de pago: ${(mets ?? []).map((x) => x.nombre).join(', ')}${cfg.acepta_efectivo !== 'no' ? ', Efectivo' : ''}\n\nLo que ha dicho el administrador (en orden):\n${crudo}` }], [], async () => ({}))
  const j = out.match(/\{[\s\S]*\}/)
  if (!j) throw new Error('respuesta sin JSON')
  return JSON.parse(j[0])
}

// Valida y resuelve contra el catálogo; devuelve problemas, líneas del resumen y el total
async function resolver(sb: SupabaseClient, cfg: Record<string, string>, d: Datos) {
  const problemas: string[] = []
  const { data: prods } = await sb.from('productos').select('id,nombre,precio').eq('activo', true)
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  const items: { producto_id: string; nombre: string; cantidad: number; precio: number }[] = []
  for (const it of d.items ?? []) {
    const p = (prods ?? []).find((x) => norm(x.nombre) === norm(String(it.sabor))) ?? (prods ?? []).find((x) => norm(x.nombre).includes(norm(String(it.sabor))) || norm(String(it.sabor)).includes(norm(x.nombre)))
    const c = Math.round(Number(it.cantidad))
    if (!p) { problemas.push(`no encontré el sabor "${it.sabor}"`); continue }
    if (!c || c < 1 || c > 500) { problemas.push(`cantidad rara para ${p.nombre}`); continue }
    items.push({ producto_id: p.id, nombre: p.nombre, cantidad: c, precio: p.precio })
  }
  if (!items.length) problemas.push('faltan los sabores y cantidades')
  const hoy = fechaBogota()
  if (d.fecha_entrega) {
    const ex = await cargarExcepciones(sb)
    if (d.fecha_entrega < hoy) problemas.push('esa fecha ya pasó')
    else if (!esDiaProduccion(d.fecha_entrega, cfg.dias_produccion ?? '', ex)) problemas.push(`${d.fecha_entrega} no es día de producción (${ex.get(d.fecha_entrega)?.nota ?? 'revisa el calendario'})`)
  }
  let tarifa = 0
  if (d.modalidad === 'domicilio') {
    const { data: tars } = await sb.from('tarifas_domicilio').select('nombre,valor').eq('activo', true)
    const t = (tars ?? []).find((x) => norm(x.nombre) === norm(String(d.zona_tarifa ?? ''))) ?? ((tars ?? []).length === 1 ? tars![0] : undefined)
    if (!t) problemas.push('falta la tarifa de domicilio (' + (tars ?? []).map((x) => x.nombre).join(', ') + ')'); else tarifa = t.valor
    const nogo = barrioSinDomicilio(cfg, d.direccion, d.nota)
    if (nogo) problemas.push(`en ${nogo} no se hace domicilio`)
  }
  const total = items.reduce((a, i) => a + i.precio * i.cantidad, 0) + tarifa
  return { problemas, items, tarifa, total }
}

function resumen(d: Datos, r: Awaited<ReturnType<typeof resolver>>): string {
  const cuando = d.fecha_entrega ? new Date(d.fecha_entrega + 'T12:00:00Z').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : ''
  const hora = d.hora_entrega ? ` a las ${horaHablada(+d.hora_entrega.split(':')[0], +d.hora_entrega.split(':')[1])}` : d.franja ? ` (${d.franja})` : ''
  return `📝 Pedido para ${d.nombre}${d.telefono ? ` (${d.telefono})` : ''}\n${r.items.map((i) => `• ${i.cantidad} × ${i.nombre}`).join('\n')}\n📅 ${cuando}${hora}\n${d.modalidad === 'domicilio' ? `🛵 Domicilio: ${d.direccion || 'dirección por confirmar (queda nota de llamar)'} (${fmt$(r.tarifa)})` : '🏪 Recoge en el local'}\n💳 ${d.metodo_pago}${d.pagado ? ' (ya pagado)' : ''}${d.nota ? `\n🗒 ${d.nota}` : ''}\nTotal: ${fmt$(r.total)}`
}

export async function asistenteAdmin(sb: SupabaseClient, cfg: Record<string, string>, from: string, texto: string): Promise<boolean> {
  const t = texto.trim()
  if (!t) return true
  if (/^(ayuda|help|men[uú]|comandos|\?)$/i.test(t)) { await sendText(from, AYUDA); return true }
  const { data: bor } = await sb.from('admin_borradores').select('*').eq('admin_telefono', from).maybeSingle()
  const vigente = bor && Date.now() - new Date(bor.actualizado_en).getTime() < 30 * 60000

  // Borrador listo: esperando "sí" / "no"
  if (vigente && bor.estado === 'confirmar') {
    if (/^(s[ií]|dale|ok|listo|confirmo|confirmado|claro|de una)\b/i.test(t)) {
      if (bor.datos?.tipo === 'cancelar_dia') {
        await sb.from('admin_borradores').delete().eq('admin_telefono', from)
        await sendText(from, 'Cancelando y avisando a los clientes… ⏳')
        await sendText(from, await ejecutarCancelacion(sb, bor.datos.fecha, bor.datos.motivo ?? null))
        return true
      }
      return await crear(sb, cfg, from, bor.datos)
    }
    if (/^(no|cancelar|cancela|descartar)\b/i.test(t)) { await sb.from('admin_borradores').delete().eq('admin_telefono', from); await sendText(from, 'Listo, descarté ese pedido.'); return true }
  }
  if (/^(cancelar|cancela)\b/i.test(t) && vigente) { await sb.from('admin_borradores').delete().eq('admin_telefono', from); await sendText(from, 'Listo, descarté ese pedido.'); return true }

  const crudo = vigente ? `${bor.crudo}\n${t}` : t
  try {
    const d = await parsear(sb, cfg, crudo)
    if (d.intencion === 'reporte' && !vigente) { await sendText(from, await reporteDia(sb, d.fecha_reporte || fechaBogota())); return true }
    if (d.intencion === 'cancelar_dia' && !vigente) {
      const fecha = d.fecha_reporte || fechaBogota()
      const v = await vistaCancelacion(sb, fecha)
      if (!v.ped.length) { await sendText(from, `No hay pedidos activos para esa fecha, no hay nada que cancelar.`); return true }
      await sb.from('admin_borradores').upsert({ admin_telefono: from, crudo: t, datos: { tipo: 'cancelar_dia', fecha, motivo: d.motivo ?? null }, estado: 'confirmar', actualizado_en: new Date().toISOString() }, { onConflict: 'admin_telefono' })
      await sendText(from, `Voy a CANCELAR ${v.ped.length} pedido${v.ped.length === 1 ? '' : 's'} y avisar a cada cliente por WhatsApp${d.motivo ? ` (motivo: ${d.motivo})` : ''}:\n${v.resumen}\n\nLos que estén fuera de la ventana de 24 h no se podrán avisar y te los listaré. ¿Confirmas? Responde "sí" o "no".`)
      return true
    }
    if (d.intencion !== 'pedido' && !vigente) { await conversarEquipo(sb, cfg, from, t, 'admin'); return true }
    const r = await resolver(sb, cfg, d)
    const falta = !d.nombre || !d.fecha_entrega || !d.modalidad || !d.metodo_pago || !r.items.length
    if (falta || r.problemas.length) {
      await sb.from('admin_borradores').upsert({ admin_telefono: from, crudo, datos: d, estado: 'preguntando', actualizado_en: new Date().toISOString() }, { onConflict: 'admin_telefono' })
      const q = r.problemas.length ? `Ojo: ${r.problemas.join('; ')}.\n${d.pregunta ?? '¿Cómo lo ajustamos?'}` : (d.pregunta ?? '¿Qué datos faltan? (sabores, fecha, domicilio o recoger, pago)')
      await sendText(from, `${q}\n\n("cancelar" para descartar)`)
      return true
    }
    await sb.from('admin_borradores').upsert({ admin_telefono: from, crudo, datos: d, estado: 'confirmar', actualizado_en: new Date().toISOString() }, { onConflict: 'admin_telefono' })
    await sendText(from, `${resumen(d, r)}\n\n¿Lo creo? Responde "sí" para confirmar, "no" para descartar o dime qué cambiar.`)
  } catch (e) {
    console.error('asistenteAdmin', e)
    if (vigente) await sendText(from, 'No pude interpretar eso 🙈 ¿Me lo dices de nuevo con el nombre, los sabores, la fecha, domicilio o recoger y el pago?')
    else await conversarEquipo(sb, cfg, from, t, 'admin')
  }
  return true
}

async function crear(sb: SupabaseClient, cfg: Record<string, string>, from: string, d: Datos): Promise<boolean> {
  const r = await resolver(sb, cfg, d)
  if (r.problemas.length) { await sendText(from, `No lo pude crear: ${r.problemas.join('; ')}. Dime cómo ajustarlo.`); return true }
  const efectivo = /efectivo/i.test(String(d.metodo_pago))
  const tel = String(d.telefono ?? '').replace(/\D/g, '')
  const chat_tel = tel ? (tel.length === 10 ? '57' + tel : tel) : null
  const sinDir = d.modalidad === 'domicilio' && !String(d.direccion ?? '').trim()
  const nota = [d.nota, 'Tomado por el administrador', sinDir ? '📞 LLAMAR al cliente para pedir la dirección/ubicación de entrega' : ''].filter(Boolean).join(' · ')
  const { data: ped, error } = await sb.from('pedidos').insert({
    cliente_nombre: d.nombre, cliente_telefono: tel || 'sin teléfono', chat_telefono: chat_tel, origen: 'manual', metodo_pago: d.metodo_pago,
    estado: efectivo ? 'pendiente_cobro' : d.pagado ? 'pago_verificado' : 'recibido', pagado: !efectivo && !!d.pagado, nota,
    fecha_entrega: d.fecha_entrega, hora_entrega_solicitada: d.hora_entrega || null, franja_horaria: d.franja || null, modalidad: d.modalidad,
    direccion: d.modalidad === 'domicilio' ? String(d.direccion ?? '').trim() || null : null, tarifa_domicilio: r.tarifa, total: r.total,
  }).select('id,numero').single()
  if (error || !ped) { await sendText(from, `No pude crear el pedido: ${error?.message ?? 'error'}`); return true }
  await sb.from('pedido_items').insert(r.items.map((i) => ({ pedido_id: ped.id, producto_id: i.producto_id, cantidad: i.cantidad, precio_unitario: i.precio })))
  await sb.from('admin_borradores').delete().eq('admin_telefono', from)
  let aviso = ''
  if (d.avisar_cliente && chat_tel) {
    const { data: ult } = await sb.from('mensajes').select('creado_en').eq('telefono', chat_tel).eq('rol', 'user').order('creado_en', { ascending: false }).limit(1).maybeSingle()
    if (ult && Date.now() - new Date(ult.creado_en).getTime() < 24 * 3600 * 1000) {
      const cuando = new Date(d.fecha_entrega + 'T12:00:00Z').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
      const id = await sendText(chat_tel, `¡Listo! Ya tomamos tu pedido ✅ Te lo entregamos ${cuando}.${!efectivo && !d.pagado ? ` Cuando hagas el pago por ${d.metodo_pago}, envíanos el comprobante por aquí.` : ''} Cualquier cambio me avisas 😊`)
      if (id) await sb.from('mensajes').insert({ telefono: chat_tel, rol: 'assistant', contenido: 'Pedido tomado por el equipo', wa_id: id })
      aviso = ' Le avisé al cliente.'
    } else aviso = ' No le avisé al cliente (WhatsApp solo permite escribirle si él escribió en las últimas 24 h).'
  }
  await sendText(from, `✅ Pedido creado para ${d.nombre} (${fmt$(r.total)}). Ya está en el micrositio.${!efectivo && !d.pagado ? ' Queda en "Por revisar" hasta que confirmes el pago.' : ''}${aviso}`)
  return true
}
