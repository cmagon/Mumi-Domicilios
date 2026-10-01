import { supabase } from './supabase'

export type EventoCliente = 'cancelado' | 'mantener' | 'pago' | 'confirmado' | 'listo' | 'en_ruta' | 'entregado' | 'tomado'
// Pasos del flujo que se avisan al cliente (paso → evento)
export const EVENTO_PASO: Record<number, EventoCliente> = { 1: 'confirmado', 4: 'listo', 5: 'en_ruta', 6: 'entregado' }

// Avisa al cliente por WhatsApp del cambio del pedido. Devuelve un texto corto para mostrar al admin (o null si no aplica).
export async function avisarCliente(pedidoId: string, evento: EventoCliente): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('notificar-cliente', { body: { pedido_id: pedidoId, evento } })
  if (error || !data?.ok) return `No se pudo avisar al cliente: ${data?.error ?? error?.message ?? 'error'}`
  if (data.enviado) return 'Cliente avisado por WhatsApp ✅'
  if (data.ventana_cerrada) return 'No se avisó al cliente: pasaron más de 24 h desde su último mensaje'
  return null
}
