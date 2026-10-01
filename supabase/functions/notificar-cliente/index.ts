// Avisa al cliente por WhatsApp cuando el admin cambia el estado de su pedido desde el micrositio (cancelado, pago confirmado, listo, en camino, entregado…).
// Solo dentro de la ventana de 24 h de WhatsApp; el mensaje queda en el historial del chat.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendText } from '../whatsapp-webhook/wa.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } })

const hora = (h?: string | null) => { if (!h) return ''; const [a, b] = h.split(':').map(Number); return `${a % 12 || 12}:${String(b).padStart(2, '0')} ${a >= 12 ? 'p. m.' : 'a. m.'}` }
const fecha = (f?: string | null) => f ? new Date(f + 'T12:00:00Z').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : ''

function mensaje(evento: string, p: any): string | null {
  const n = `#${p.numero}`
  const cuando = [fecha(p.fecha_entrega), p.hora_entrega_solicitada ? `a las ${hora(p.hora_entrega_solicitada)}` : p.franja_horaria ? `en la franja ${p.franja_horaria}` : ''].filter(Boolean).join(' ')
  switch (evento) {
    case 'cancelado': return `Tu pedido ${n} quedó cancelado ✅${p.pagado ? ' El equipo te escribe para lo del reembolso.' : ''} Si fue un error o quieres hacer otro, escríbeme y con gusto te ayudo 😊`
    case 'tomado': return `¡Listo! Ya tomamos tu pedido ${n} ✅${cuando ? ` Te lo entregamos ${cuando}.` : ''}${p.pagado ? '' : p.metodo_pago && !/efectivo/i.test(p.metodo_pago) ? ` Cuando hagas el pago por ${p.metodo_pago}, envíanos el comprobante por aquí.` : ''} Cualquier cambio me avisas 😊`
    case 'mantener': return `Listo 😊 tu pedido ${n} sigue en pie${cuando ? ` para ${cuando}` : ''}. ¡Gracias por avisarnos!`
    case 'pago': return `¡Recibimos tu pago del pedido ${n}! 🎉 Ya queda confirmado${cuando ? ` para ${cuando}` : ''}.`
    case 'confirmado': return `Tu pedido ${n} quedó confirmado ✅${cuando ? ` Te lo entregamos ${cuando}.` : ''}`
    case 'listo': return p.modalidad === 'domicilio' ? `Tu pedido ${n} ya está listo y pronto sale a tu dirección 🍪` : `Tu pedido ${n} ya está listo para recoger 🍪`
    case 'en_ruta': return `Tu pedido ${n} va en camino 🛵 ¡Ya casi llega!`
    case 'entregado': return `Tu pedido ${n} fue entregado. ¡Gracias por elegirnos, que lo disfrutes! 🍪💛`
    default: return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = Deno.env.get('SUPABASE_URL')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return json({ ok: false, error: 'No autenticado' }, 401)
  const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: perfil } = await sb.from('perfiles').select('rol').eq('user_id', u.user.id).maybeSingle()
  if (perfil?.rol !== 'admin') return json({ ok: false, error: 'Sin permiso' }, 403)

  const { pedido_id, evento } = await req.json().catch(() => ({}))
  const { data: p } = await sb.from('pedidos').select('numero,chat_telefono,metodo_pago,modalidad,pagado,fecha_entrega,franja_horaria,hora_entrega_solicitada').eq('id', pedido_id).maybeSingle()
  if (!p) return json({ ok: false, error: 'Pedido no encontrado' }, 404)
  if (!p.chat_telefono) return json({ ok: true, enviado: false, motivo: 'pedido manual (sin chat de WhatsApp)' })
  const { data: c } = await sb.from('config').select('valor').eq('clave', 'avisar_cliente_cambios').maybeSingle()
  if (c?.valor === 'no') return json({ ok: true, enviado: false, motivo: 'avisos al cliente desactivados' })
  const texto = mensaje(String(evento), p)
  if (!texto) return json({ ok: false, error: 'Evento no válido' }, 400)

  const { data: ult } = await sb.from('mensajes').select('creado_en').eq('telefono', p.chat_telefono).eq('rol', 'user').order('creado_en', { ascending: false }).limit(1).maybeSingle()
  if (!ult || Date.now() - new Date(ult.creado_en).getTime() > 24 * 3600 * 1000)
    return json({ ok: true, enviado: false, ventana_cerrada: true, motivo: 'pasaron más de 24 h desde el último mensaje del cliente: WhatsApp no permite escribirle sin plantilla' })
  const waId = await sendText(p.chat_telefono, texto)
  if (!waId) return json({ ok: false, error: 'WhatsApp no aceptó el mensaje' })
  await sb.from('mensajes').insert({ telefono: p.chat_telefono, rol: 'assistant', contenido: texto, wa_id: waId })
  return json({ ok: true, enviado: true })
})
