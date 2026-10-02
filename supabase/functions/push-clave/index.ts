// Devuelve la clave pública VAPID (la crea la primera vez) al admin autenticado, para suscribir el dispositivo.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { claves } from '../whatsapp-webhook/push.ts'

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
  return json({ ok: true, publica: (await claves(sb)).publica })
})
