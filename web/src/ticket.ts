import type { Pedido } from './types'
import { cop } from './hooks'
import { fechaCorta, horaBonita } from './pedidoFlow'
import QRCode from 'qrcode'

// Teléfono sin el indicativo de Colombia (57) para el ticket
const sin57 = (t = '') => String(t).replace(/\D/g, '').replace(/^57(?=\d{10}$)/, '')
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

export async function imprimirTickets(pedidos: Pedido[]) {
  const mapa = (o: Pedido) => `https://maps.google.com/?q=${Number(o.lat).toFixed(6)},${Number(o.lng).toFixed(6)}`
  const qrs = await Promise.all(pedidos.map((o) => (o.modalidad === 'domicilio' && o.lat != null && o.lng != null ? QRCode.toDataURL(mapa(o), { margin: 1, width: 200 }).catch(() => '') : Promise.resolve(''))))
  const html = pedidos.map((o, k) => `
    <div class="t"><h3>Pedido #${o.numero}</h3>
    <p class="entrega">ENTREGAR: ${esc(fechaCorta(o.fecha_entrega))}<br/>${o.hora_entrega_solicitada ? 'HORA PEDIDA: ' + esc(horaBonita(o.hora_entrega_solicitada)) : (o.franja_horaria ? 'FRANJA: ' + esc(o.franja_horaria) : '')}</p>
    <p><b>${esc(o.cliente_nombre)}</b><br/>Tel: ${esc(sin57(o.cliente_telefono))}</p>
    <p>${o.modalidad === 'domicilio' ? (o.direccion_aprox ? 'DIRECCION APROX. (ubicacion compartida): ' : 'Domicilio: ') + esc(o.direccion ?? '') : 'RECOGE EN PUNTO'}</p>
    ${qrs[k] ? `<p class="qr">UBICACION (escanea):<br/><img src="${qrs[k]}" width="150" height="150"/></p>` : ''}
    <ul>${(o.pedido_items ?? []).map((i) => `<li>${i.cantidad} × ${esc(i.productos?.nombre ?? '')}</li>`).join('')}</ul>
    ${o.metodo_pago?.toLowerCase().includes('efectivo') && !o.pagado
      ? `<p class="big">PAGA EN EFECTIVO — COBRAR ${cop(o.total)}</p>` : o.pagado ? `<p>Pago: ${esc(o.metodo_pago ?? '')} (PAGADO)</p>` : `<p class="big">PAGO PENDIENTE POR ${esc((o.metodo_pago ?? 'TRANSFERENCIA').toUpperCase())} — VERIFICAR ${cop(o.total)}</p>`}
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
