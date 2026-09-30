export type Producto = { id: string; nombre: string; descripcion: string; detalles?: string; precio: number; foto_url: string | null; activo: boolean }
export type Stock = { id: string; fecha: string; producto_id: string; cantidad_agendada: number; cantidad_excedente: number; total_disponible: number }
export type Pedido = {
  id: string; numero: number; cliente_nombre: string; cliente_telefono: string; origen: 'bot' | 'manual'; estado: string
  metodo_pago: string | null; pagado: boolean; modalidad: string; direccion: string | null; tarifa_domicilio: number; total: number
  nota: string | null; comprobante_url: string | null; chat_telefono?: string | null; archivado?: boolean; pendiente_produccion?: boolean; hora_entrega_solicitada?: string | null; direccion_aprox?: boolean; lat?: number | null; lng?: number | null; fecha_entrega: string | null; franja_horaria: string | null; creado_en: string
  pedido_items?: { cantidad: number; producto_id: string; productos: { nombre: string } | null }[]
}
export const ESTADOS = ['recibido', 'pago_verificado', 'pendiente_cobro', 'impreso', 'empacado', 'listo', 'entregado', 'cancelado']
