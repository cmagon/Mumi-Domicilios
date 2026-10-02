// Envía una campaña (imagen + texto + hasta 2 botones) a los clientes elegidos por el admin.
// Solo se envía a quienes escribieron en las últimas 24 h (ventana abierta de WhatsApp); nunca a los números del equipo.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendButtonsImagen, sendImage, sendText } from '../whatsapp-webhook/wa.ts'
import { numerosEquipo } from '../whatsapp-webhook/config.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } })
const MAX = 250

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = Deno.env.get('SUPABASE_URL')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return json({ ok: false, error: 'No autenticado' }, 401)
  const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: perfil } = await sb.from('perfiles').select('rol').eq('user_id', u.user.id).maybeSingle()
  if (perfil?.rol !== 'admin') return json({ ok: false, error: 'Sin permiso' }, 403)

  const { campana_id, telefonos } = await req.json().catch(() => ({}))
  const { data: c } = await sb.from('campanas').select('*').eq('id', campana_id).maybeSingle()
  if (!c) return json({ ok: false, error: 'No encontré la campaña' }, 404)
  const { data: cfgRows } = await sb.from('config').select('clave,valor').in('clave', ['admin_numeros', 'domiciliario_numero'])
  const equipo = new Set(numerosEquipo(Object.fromEntries((cfgRows ?? []).map((r) => [r.clave, r.valor])) as Record<string, string>))
  const pedidos: string[] = [...new Set(((telefonos ?? []) as string[]).map((t) => String(t).replace(/\D/g, '')).filter((t) => t && !equipo.has(t)))].slice(0, MAX)
  if (!pedidos.length) return json({ ok: false, error: 'Elige al menos un cliente' }, 400)

  // Solo ventana abierta (se revalida aquí) y quienes aún no la recibieron
  const desde = new Date(Date.now() - 23.5 * 3600 * 1000).toISOString()
  const [{ data: abiertos }, { data: previos }] = await Promise.all([
    sb.from('mensajes').select('telefono').eq('rol', 'user').in('telefono', pedidos).gte('creado_en', desde),
    sb.from('campana_envios').select('telefono').eq('campana_id', c.id).eq('estado', 'enviado'),
  ])
  const abiertas = new Set((abiertos ?? []).map((m) => m.telefono as string))
  const yaEnviado = new Set((previos ?? []).map((m) => m.telefono as string))
  const botones = [c.boton1, c.boton2].filter((b: string | null) => b && b.trim()).map((b: string, i: number) => ({ id: `camp:${c.id}:${i + 1}`, title: b.trim() }))
  let enviados = 0, fallidos = 0, omitidos = 0
  const detalle: string[] = []

  const enviar = async (tel: string) => {
    if (!abiertas.has(tel)) { omitidos++; detalle.push(`${tel}: ventana cerrada`); return }
    if (yaEnviado.has(tel)) { omitidos++; return }
    const id = botones.length ? await sendButtonsImagen(tel, c.texto, botones, c.imagen_url)
      : c.imagen_url ? await sendImage(tel, c.imagen_url, c.texto) : await sendText(tel, c.texto)
    if (id) {
      enviados++
      await sb.from('campana_envios').upsert({ campana_id: c.id, telefono: tel, estado: 'enviado', wa_id: id, enviado_en: new Date().toISOString() }, { onConflict: 'campana_id,telefono' })
      await sb.from('mensajes').insert({ telefono: tel, rol: 'assistant', contenido: `[Promoción enviada por el negocio: «${String(c.texto).slice(0, 300)}»${botones.length ? ` — botones: ${botones.map((b) => b.title).join(' / ')}` : ''}]`, wa_id: id })
    } else {
      fallidos++; detalle.push(`${tel}: WhatsApp no aceptó el mensaje`)
      await sb.from('campana_envios').upsert({ campana_id: c.id, telefono: tel, estado: 'fallido', error: 'WhatsApp no aceptó el mensaje' }, { onConflict: 'campana_id,telefono' })
    }
  }
  // En lotes de 5 para no saturar la API
  for (let i = 0; i < pedidos.length; i += 5) await Promise.all(pedidos.slice(i, i + 5).map(enviar))
  if (enviados) await sb.from('campanas').update({ estado: 'enviada', enviada_en: new Date().toISOString() }).eq('id', c.id)
  return json({ ok: true, enviados, fallidos, omitidos, detalle: detalle.slice(0, 20) })
})
