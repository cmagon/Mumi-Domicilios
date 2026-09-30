// Cliente Supabase falso para pruebas de humo (encadenable)
export const calls = []
const DATA = {
  config: [['proveedor_ia','gemini'],['system_prompt','PROMPT'],['dias_produccion','miercoles,viernes'],['franjas_entrega','14:00-16:00,16:00-18:00'],['admin_numeros','573000000000'],
    ['espera_agrupar_seg','0'],['simular_escritura','no'],['acepta_efectivo','si']].map(([clave, valor]) => ({ clave, valor })),
  config_secretos: [{ clave: 'key_gemini', valor: 'k' }],
  mensajes: [{ rol: 'user', contenido: 'hola quiero una de limon', wa_id: 'w1' }],
  productos: [{ id: 'p1', nombre: 'Pie de limón', precio: 7000, activo: true }],
  pedidos: [], conversaciones: [], metodos_pago: [{ nombre: 'Nequi', numero_cuenta: '3001234567', tipo_cuenta: '' }], tarifas_domicilio: [],
}
function builder(table) {
  const b = { _t: table }
  const chain = new Proxy(b, { get(t, k) {
    if (k === 'then') return (res) => res({ data: DATA[table] ?? [], error: null, count: 0 })
    if (k === 'maybeSingle' || k === 'single') return () => Promise.resolve({ data: (DATA[table] ?? [])[0] ?? null, error: null })
    if (['insert', 'upsert', 'update', 'delete'].includes(k)) return (...a) => { calls.push([table, k, JSON.stringify(a[0]).slice(0, 100)]); return chain }
    return () => chain
  } })
  return chain
}
export const createClient = () => ({ from: builder, rpc: async (n) => ({ data: [], error: null }), storage: { from: () => ({ upload: async () => ({}), download: async () => ({ data: null }) }) } })
