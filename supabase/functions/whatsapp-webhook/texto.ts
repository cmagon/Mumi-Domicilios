// El número de pedido es interno: nunca se le dice al cliente
export const sinNumeroPedido = (t: string) => t
  .replace(/\b(el|tu|su|un|del)\s+(pedido|orden)\s*(?:n[úu]mero|n[oº]\.?|#)?\s*#?\d+/gi, (_m, a) => `${a.toLowerCase() === 'del' ? 'de tu' : 'tu'} pedido`)
  .replace(/\b(pedido|orden)\s*(?:n[úu]mero|n[oº]\.?|#)\s*#?\d+/gi, 'tu pedido')
  .replace(/\s?#\d+\b/g, '')


// Hora como se dice en Colombia: "5:30 de la tarde", "8 de la mañana", "7 de la noche" (nunca a. m./p. m.)
export function horaHablada(h: number, m = 0): string {
  const h12 = h % 12 || 12
  const periodo = h === 12 && m === 0 ? 'del mediodía' : h < 12 ? 'de la mañana' : h < 19 ? 'de la tarde' : 'de la noche'
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''} ${periodo}`
}
// "14:00-16:00,16:00-18:00" → "2 a 4 de la tarde, 4 a 6 de la tarde"
export function franjasHabladas(franjas: string): string {
  return (franjas ?? '').split(',').map((f) => {
    const m = f.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?$/)
    if (!m) return f.trim()
    const a = horaHablada(+m[1], +(m[2] ?? 0)), b = horaHablada(+m[3], +(m[4] ?? 0))
    const pa = a.replace(/^[\d:]+ /, ''), pb = b.replace(/^[\d:]+ /, '')
    return pa === pb ? `${a.slice(0, a.length - pa.length - 1)} a ${b}` : `${a} a ${b}`
  }).join(', ')
}
