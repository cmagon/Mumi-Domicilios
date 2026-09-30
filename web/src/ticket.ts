import type { Pedido } from './types'
import { cop } from './hooks'
import { fechaCorta, horaBonita } from './pedidoFlow'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

export function imprimirTickets(pedidos: Pedido[]) {
  const html = pedidos.map((o) => `
    <div class="t"><h3>Pedido #${o.numero}</h3>
    <p class="entrega">ENTREGAR: ${esc(fechaCorta(o.fecha_entrega))}<br/>${o.hora_entrega_solicitada ? 'HORA PEDIDA: ' + esc(horaBonita(o.hora_entrega_solicitada)) : (o.franja_horaria ? 'FRANJA: ' + esc(o.franja_horaria) : '')}</p>
    <p><b>${esc(o.cliente_nombre)}</b><br/>Tel: ${esc(o.cliente_telefono)}</p>
    <p>${o.modalidad === 'domicilio' ? (o.direccion_aprox ? 'DIRECCION APROX. (ubicacion compartida): ' : 'Domicilio: ') + esc(o.direccion ?? '') : 'RECOGE EN PUNTO'}</p>
    <ul>${(o.pedido_items ?? []).map((i) => `<li>${i.cantidad} × ${esc(i.productos?.nombre ?? '')}</li>`).join('')}</ul>
    ${o.metodo_pago?.toLowerCase().includes('efectivo') && !o.pagado
      ? `<p class="big">PAGA EN EFECTIVO — COBRAR ${cop(o.total)}</p>` : `<p>Pago: ${esc(o.metodo_pago ?? '')}</p>`}
    ${o.nota ? `<p class="nota">NOTA: ${esc(o.nota)}</p>` : ''}
    </div>`).join('')
  const w = window.open('', '_blank', 'width=400,height=600')
  if (!w) return
  w.document.write(`<html><head><title>Tickets</title><style>
    body{font-family:monospace;width:280px} .t{page-break-after:always;padding:8px}
    .big{font-size:20px;font-weight:bold;border:2px solid #000;padding:6px} .nota{font-weight:bold;font-size:16px} .entrega{font-weight:bold;font-size:18px;border:2px solid #000;padding:6px}
    </style></head><body>${html}</body></html>`)
  w.document.close(); w.focus(); w.print()
}
