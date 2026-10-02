// Analiza conversaciones con IA. Lo invoca el botón "Analizar con IA" del micrositio (sesión de admin).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { analizarSesiones, aprenderDeSesiones, aprenderDelEquipo, extraerPedido } from '../whatsapp-webhook/analisis.ts'

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

  const { data } = await sb.from('config').select('clave,valor')
  const cfg = Object.fromEntries((data ?? []).map((r) => [r.clave, r.valor])) as Record<string, string>
  const body = await req.json().catch(() => ({}))
  try {
    if (body.modo === 'extraer_pedido' && body.telefono) return json({ ok: true, pedido: await extraerPedido(sb, cfg, String(body.telefono)) })
    if (body.modo === 'equipo') { const r = await aprenderDelEquipo(sb, cfg, Math.min(Number(body.limite) || 5, 10)); return json({ ok: true, ...r }) }
    if (body.modo === 'aprender') { const r = await aprenderDeSesiones(sb, cfg, Math.min(Number(body.limite) || 5, 10)); return json({ ok: true, ...r }) }
    const n = await analizarSesiones(sb, cfg, Math.min(Number(body.limite) || 10, 20), body.telefono && body.inicio ? { telefono: body.telefono, inicio: body.inicio } : undefined)
    return json({ ok: true, analizadas: n })
  } catch (e) { return json({ ok: false, error: String(e).slice(0, 300) }) }
})
