// Render de tickets: texto plano (vista previa) y ESC/POS (impresora térmica 58/80 mm)
const ESC = 0x1b, GS = 0x1d
const ascii = (s = '') => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ñ/g, 'n').replace(/Ñ/g, 'N').replace(/[^\x20-\x7e]/g, '?')
const cop = (n) => '$' + Number(n).toLocaleString('es-CO')

export function lineas(o, ancho = 32) {
  const sep = '-'.repeat(ancho)
  const efectivo = /efectivo/i.test(o.metodo_pago ?? '') && !o.pagado
  const out = [{ t: `PEDIDO #${o.numero}`, big: true, center: true }, { t: sep },
    { t: o.cliente_nombre, bold: true }, { t: `Tel: ${o.cliente_telefono}` },
    { t: o.modalidad === 'domicilio' ? `${o.direccion_aprox ? 'DIRECCION APROX. (ubicacion compartida)' : 'DOMICILIO'}: ${o.direccion ?? ''}` : 'RECOGE EN PUNTO' }]
  if (o.fecha_entrega) out.push({ t: `Entrega: ${o.fecha_entrega} ${o.franja_horaria ?? ''}` })
  out.push({ t: sep })
  for (const i of o.pedido_items ?? []) out.push({ t: `${i.cantidad} x ${i.productos?.nombre ?? ''}`, bold: true })
  out.push({ t: sep }, { t: `TOTAL: ${cop(o.total)}`, bold: true })
  out.push(efectivo ? { t: `PAGA EN EFECTIVO - COBRAR ${cop(o.total)}`, big: true, center: true }
                    : { t: `Pago: ${o.metodo_pago ?? ''}${o.pagado ? ' (PAGADO)' : ''}` })
  if (o.nota) out.push({ t: sep }, { t: `NOTA: ${o.nota}`, bold: true })
  out.push({ t: sep }, { t: `#${o.numero} ${o.cliente_nombre}`, center: true })
  return out
}

export function preview(o) { return lineas(o).map((l) => l.t).join('\n') }

export function escpos(o, ancho = 32) {
  const b = [ESC, 0x40] // init
  const push = (...x) => b.push(...x)
  const text = (s) => push(...Buffer.from(ascii(s) + '\n', 'latin1'))
  for (const l of lineas(o, ancho)) {
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
