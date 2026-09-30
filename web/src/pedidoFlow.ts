import type { Pedido } from './types'

// Pasos consecutivos del pedido. "Confirmado" agrupa pago_verificado (transferencia) y pendiente_cobro (efectivo).
export const PASOS = [
  { id: 'recibido', label: 'Recibido', accion: 'Recibido' },
  { id: 'confirmado', label: 'Confirmado', accion: 'Confirmar pedido' },
  { id: 'impreso', label: 'Ticket', accion: 'Marcar ticket impreso' },
  { id: 'empacado', label: 'Empacado', accion: 'Marcar empacado' },
  { id: 'listo', label: 'Listo', accion: 'Marcar listo' },
  { id: 'en_ruta', label: 'En camino', accion: 'Salió a entregar' },
  { id: 'entregado', label: 'Entregado', accion: 'Marcar entregado' },
] as const

export const esEfectivo = (o: Pick<Pedido, 'metodo_pago'>) => /efectivo/i.test(o.metodo_pago ?? '')

export function pasoDe(estado: string): number {
  switch (estado) {
    case 'recibido': return 0
    case 'pago_verificado': case 'pendiente_cobro': return 1
    case 'impreso': return 2
    case 'empacado': return 3
    case 'listo': return 4
    case 'en_ruta': return 5
    case 'entregado': return 6
    default: return 0
  }
}

// Estado de base de datos que corresponde a un paso
export function estadoDePaso(i: number, o: Pedido): string {
  if (i === 1) return esEfectivo(o) ? 'pendiente_cobro' : 'pago_verificado'
  return PASOS[i].id
}

// ---------- Fechas y horas ----------
const hoyISO = () => new Date().toLocaleDateString('en-CA')
const sumarDias = (iso: string, n: number) => new Date(new Date(iso + 'T12:00:00').getTime() + n * 86400000).toLocaleDateString('en-CA')

export function etiquetaFecha(f: string | null): string {
  if (!f) return 'Sin fecha de entrega'
  const hoy = hoyISO()
  const larga = new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
  if (f === hoy) return `Hoy · ${larga}`
  if (f === sumarDias(hoy, 1)) return `Mañana · ${larga}`
  if (f === sumarDias(hoy, -1)) return `Ayer · ${larga}`
  return larga
}
export const fechaCorta = (f: string | null) => f ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }) : 'sin fecha'

// "15:00:00" | "15:00" → "3:00 p. m."
export function horaBonita(h?: string | null): string {
  if (!h) return ''
  const [hh, mm] = h.split(':').map(Number)
  return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'p. m.' : 'a. m.'}`
}
const minutos = (h?: string | null) => { if (!h) return null; const [a, b] = h.split(':').map(Number); return a * 60 + (b || 0) }
const inicioFranja = (fr?: string | null) => { const m = fr?.match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null }

// Prioridad dentro de un día: hora pedida (la más temprana primero), luego franja, luego orden de llegada
export function minutoEntrega(o: Pedido): number { return minutos(o.hora_entrega_solicitada) ?? inicioFranja(o.franja_horaria) ?? 24 * 60 }
export function claveHora(o: Pedido): { clave: string; etiqueta: string } {
  if (o.hora_entrega_solicitada) return { clave: 'H' + o.hora_entrega_solicitada.slice(0, 5), etiqueta: `🕒 ${horaBonita(o.hora_entrega_solicitada)} · hora pedida por el cliente` }
  if (o.franja_horaria) return { clave: 'F' + o.franja_horaria, etiqueta: `Franja ${o.franja_horaria}` }
  return { clave: 'S', etiqueta: 'Sin hora definida' }
}
export function esUrgente(o: Pedido): boolean {
  if (o.fecha_entrega !== hoyISO() || !o.hora_entrega_solicitada || pasoDe(o.estado) >= 4) return false
  const ahora = new Date(); const m = minutos(o.hora_entrega_solicitada)!
  return m - (ahora.getHours() * 60 + ahora.getMinutes()) <= 60
}
