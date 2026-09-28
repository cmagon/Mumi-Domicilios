// Prueba sin base de datos ni impresora: imprime un ticket de ejemplo
import { crearImpresora } from './printers.mjs'
const pedido = { numero: 12, cliente_nombre: 'María Pérez', cliente_telefono: '3001234567', modalidad: 'domicilio',
  direccion: 'Cra 19d #21-35, Barrio La Granja', fecha_entrega: '2026-10-02', franja_horaria: '14:00-16:00',
  metodo_pago: 'Efectivo', pagado: false, total: 34000, nota: 'sin azúcar, evento 30 personas',
  pedido_items: [{ cantidad: 2, productos: { nombre: 'Cacao del Guaviare' } }, { cantidad: 1, productos: { nombre: 'Maracuyá' } }] }
await crearImpresora()(pedido)
