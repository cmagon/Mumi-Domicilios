// Agente de impresión: corre en el dispositivo dedicado del punto de producción.
// Imprime al confirmarse el pedido (pago verificado / efectivo), respeta los pedidos agendados
// (solo imprime cuando llega su fecha) y atiende las solicitudes de reimpresión del micrositio.
import { createClient } from '@supabase/supabase-js'
import { crearImpresora } from './printers.mjs'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POLL_SECONDS = '5', PRINT_HOLD_SECONDS = '90' } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const imprimir = crearImpresora()
const SEL = '*, pedido_items(cantidad, productos(nombre))'
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })

async function ciclo() {
  // 1) Pedidos nuevos: se "reclaman" cambiando el estado a impreso; solo quien logra el update imprime.
  const { data: nuevos } = await sb.from('pedidos').select('id').in('estado', ['pago_verificado', 'pendiente_cobro'])
    .lte('fecha_entrega', hoy())
    // Espera unos segundos tras crear el pedido: si el cliente cambia el pago o la dirección, el ticket sale ya corregido
    .lte('creado_en', new Date(Date.now() - Number(PRINT_HOLD_SECONDS) * 1000).toISOString())
    .order('creado_en')
  for (const { id } of nuevos ?? []) {
    const { data: reclamado } = await sb.from('pedidos').update({ estado: 'impreso' }).eq('id', id)
      .in('estado', ['pago_verificado', 'pendiente_cobro']).select(SEL).maybeSingle()
    if (!reclamado) continue
    try { await imprimir(reclamado) }
    catch (e) { // devuelve el pedido a la cola para reintentar
      console.error(`Fallo imprimiendo #${reclamado.numero}:`, e.message)
      await sb.from('pedidos').update({ estado: reclamado.pagado || !/efectivo/i.test(reclamado.metodo_pago ?? '') ? 'pago_verificado' : 'pendiente_cobro' }).eq('id', id)
    }
  }
  // 2) Reimpresiones pedidas desde el micrositio
  const { data: re } = await sb.from('pedidos').select(SEL).eq('reimprimir', true)
  for (const p of re ?? []) {
    try { await imprimir(p); await sb.from('pedidos').update({ reimprimir: false }).eq('id', p.id) }
    catch (e) { console.error(`Fallo reimprimiendo #${p.numero}:`, e.message) }
  }
}

console.log(`Agente de impresión activo (driver: ${process.env.PRINTER_DRIVER ?? 'console'})`)
for (;;) {
  try { await ciclo() } catch (e) { console.error('ciclo', e.message) }
  await new Promise((r) => setTimeout(r, Number(POLL_SECONDS) * 1000))
}
