import net from 'node:net'
import { appendFileSync } from 'node:fs'
import { escpos, preview } from './ticket.mjs'

// PRINTER_DRIVER: console (sin impresora, imprime vista previa) | tcp (impresora de red, puerto 9100) | file (vuelca bytes ESC/POS)
export function crearImpresora(env = process.env) {
  const driver = env.PRINTER_DRIVER ?? 'console'
  const ancho = Number(env.PRINTER_COLS ?? 32) // 32 = 58 mm, 48 = 80 mm
  if (driver === 'tcp') {
    return (pedido) => new Promise((ok, fail) => {
      const s = net.connect({ host: env.PRINTER_HOST, port: Number(env.PRINTER_PORT ?? 9100), timeout: 8000 })
      s.on('timeout', () => { s.destroy(); fail(new Error('timeout impresora')) })
      s.on('error', fail)
      s.on('connect', () => s.end(escpos(pedido, ancho), ok))
    })
  }
  if (driver === 'file') return async (pedido) => appendFileSync(env.PRINTER_FILE ?? 'tickets.bin', escpos(pedido, ancho))
  return async (pedido) => console.log('\n===== TICKET (simulado) =====\n' + preview(pedido) + '\n=============================\n')
}
