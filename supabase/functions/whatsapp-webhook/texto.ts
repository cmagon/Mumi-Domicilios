// El número de pedido es interno: nunca se le dice al cliente
export const sinNumeroPedido = (t: string) => t
  .replace(/\b(el|tu|su|un|del)\s+(pedido|orden)\s*(?:n[úu]mero|n[oº]\.?|#)?\s*#?\d+/gi, (_m, a) => `${a.toLowerCase() === 'del' ? 'de tu' : 'tu'} pedido`)
  .replace(/\b(pedido|orden)\s*(?:n[úu]mero|n[oº]\.?|#)\s*#?\d+/gi, 'tu pedido')
  .replace(/\s?#\d+\b/g, '')

