// El admin abrió un chat atendido por una persona: recién ahí se marca como leído en WhatsApp (palomita azul) el último mensaje del cliente.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { marcarLeidoSolo } from '../whatsapp-webhook/wa.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = Deno.env.get('SUPABASE_URL')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return json({ ok: false, error: 'No autenticado' }, 401)
  const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: perfil } = await sb.from('perfiles').select('rol').eq('user_id', u.user.id).maybeSingle()
  if (perfil?.rol !== 'admin') return json({ ok: false, error: 'Sin permiso' }, 403)
  const { telefono } = await req.json().catch(() => ({}))
  if (!telefono) return json({ ok: false, error: 'Falta el teléfono' }, 400)
  const { data: m } = await sb.from('mensajes').select('wa_id,creado_en').eq('telefono', telefono).eq('rol', 'user').not('wa_id', 'is', null).order('creado_en', { ascending: false }).limit(1).maybeSingle()
  if (!m?.wa_id || Date.now() - new Date(m.creado_en).getTime() > 24 * 3600 * 1000) return json({ ok: true, marcado: false })
  await marcarLeidoSolo(m.wa_id)
  return json({ ok: true, marcado: true })
})
