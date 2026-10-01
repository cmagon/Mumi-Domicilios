// Render de tickets: texto plano (vista previa) y ESC/POS (impresora térmica 58/80 mm)
const ESC = 0x1b, GS = 0x1d
const ascii = (s = '') => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ñ/g, 'n').replace(/Ñ/g, 'N').replace(/[^\x20-\x7e]/g, '?')
// Teléfono sin el indicativo de Colombia (57) para el ticket
const sin57 = (t = '') => String(t).replace(/\D/g, '').replace(/^57(?=\d{10}$)/, '')
const cop = (n) => '$' + Number(n).toLocaleString('es-CO')

const mapa = (o) => `https://maps.google.com/?q=${Number(o.lat).toFixed(6)},${Number(o.lng).toFixed(6)}`

export function lineas(o, ancho = 32) {
  const sep = '-'.repeat(ancho)
  const efectivo = /efectivo/i.test(o.metodo_pago ?? '') && !o.pagado
  const fecha = o.fecha_entrega ? new Date(o.fecha_entrega + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }) : 'sin fecha'
  const hora = (h) => { const [a, b] = h.split(':').map(Number); return `${a % 12 || 12}:${String(b).padStart(2, '0')} ${a >= 12 ? 'PM' : 'AM'}` }
  const out = [{ t: `PEDIDO #${o.numero}`, big: true, center: true },
    { t: `ENTREGAR ${fecha}`.toUpperCase(), big: true, center: true },
    ...(o.hora_entrega_solicitada ? [{ t: `HORA PEDIDA: ${hora(o.hora_entrega_solicitada)}`, big: true, center: true }]
      : o.franja_horaria ? [{ t: `FRANJA: ${o.franja_horaria}`, bold: true, center: true }] : []),
    { t: sep },
    { t: o.cliente_nombre, bold: true }, { t: `Tel: ${sin57(o.cliente_telefono)}` },
    { t: o.modalidad === 'domicilio' ? (o.direccion ? `${o.direccion_aprox ? 'DIRECCION APROX. (ubicacion compartida)' : 'DOMICILIO'}: ${o.direccion}` : 'DOMICILIO: DIRECCION POR CONFIRMAR - LLAMAR AL CLIENTE') : 'RECOGE EN PUNTO' },
    ...(o.modalidad === 'domicilio' && o.lat != null && o.lng != null ? [{ t: `MAPA: ${mapa(o)}` }, { qr: mapa(o) }] : [])]
  out.push({ t: sep })
  for (const i of o.pedido_items ?? []) out.push({ t: `${i.cantidad} x ${i.productos?.nombre ?? ''}`, bold: true })
  out.push({ t: sep }, { t: `TOTAL: ${cop(o.total)}`, bold: true })
  out.push(efectivo ? { t: `PAGA EN EFECTIVO - COBRAR ${cop(o.total)}`, big: true, center: true }
                    : o.pagado ? { t: `Pago: ${o.metodo_pago ?? ''} (PAGADO)` }
                    : { t: `PAGO PENDIENTE POR ${(o.metodo_pago ?? 'TRANSFERENCIA').toUpperCase()} - VERIFICAR ${cop(o.total)}`, big: true, center: true })
  if (o.nota) out.push({ t: sep }, { t: `NOTA: ${o.nota}`, bold: true })
  out.push({ t: sep }, { t: `#${o.numero} ${o.cliente_nombre}`, center: true })
  return out
}

export function preview(o) { return lineas(o).map((l) => l.t ?? `[QR] ${l.qr}`).join('\n') }

export function escpos(o, ancho = 32) {
  const b = [ESC, 0x40] // init
  const push = (...x) => b.push(...x)
  const text = (s) => push(...Buffer.from(ascii(s) + '\n', 'latin1'))
  for (const l of lineas(o, ancho)) {
    if (l.qr) { // código QR nativo ESC/POS (modelo 2, módulo 6, corrección L)
      const d = Buffer.from(l.qr, 'latin1'), n = d.length + 3
      push(ESC, 0x61, 1)
      push(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0)
      push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6)
      push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x30)
      push(GS, 0x28, 0x6b, n & 255, n >> 8, 0x31, 0x50, 0x30, ...d)
      push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30)
      push(0x0a)
      continue
    }
    push(ESC, 0x61, l.center ? 1 : 0)          // alineación
    push(ESC, 0x45, l.bold || l.big ? 1 : 0)   // negrita
    push(GS, 0x21, l.big ? 0x11 : 0x00)        // doble alto/ancho
    // envuelve líneas largas según el ancho (a doble ancho caben la mitad)
    const max = l.big ? Math.floor(ancho / 2) : ancho
    const palabras = ascii(l.t).split(' '); let cur = ''
    for (const p of palabras) { if ((cur + ' ' + p).trim().length > max) { text(cur); cur = p } else cur = (cur + ' ' + p).trim() }
    text(cur)
  }
  push(GS, 0x21, 0, ESC, 0x45, 0, ESC, 0x61, 0)
  push(ESC, 0x64, 4)      // avanza 4 líneas
  push(GS, 0x56, 0x42, 0) // corte parcial
  return Buffer.from(b)
}
