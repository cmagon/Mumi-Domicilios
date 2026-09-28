// Database Webhook (pedidos UPDATE): cuando un pedido pasa a "listo", avisa al domiciliario con botones.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendButtons } from '../whatsapp-webhook/wa.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('NOTIFY_WEBHOOK_SECRET')) return new Response('forbidden', { status: 403 })
  const { record, old_record } = await req.json()
  if (record?.estado !== 'listo' || old_record?.estado === 'listo') return new Response('skip')
  const { data: c } = await sb.from('config').select('valor').eq('clave', 'domiciliario_numero').maybeSingle()
  const to = (c?.valor ?? '').replace(/\D/g, '')
  if (!to) return new Response('sin domiciliario')
  const cobro = record.pagado ? 'YA PAGADO' : `COBRAR $${record.total} (${record.metodo_pago})`
  await sendButtons(to, `Pedido #${record.numero}\n${record.cliente_nombre} — ${record.cliente_telefono}\n${record.direccion ?? 'Recoge en punto'}\n${cobro}`,
    [{ id: `recogido:${record.id}`, title: '📦 Recogido' }, { id: `entregado:${record.id}`, title: record.pagado ? '✅ Entregado' : '✅ Entregado y cobrado' }])
  return new Response('ok')
})
