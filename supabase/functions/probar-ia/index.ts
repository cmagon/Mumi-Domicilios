// Botón "Probar IA" del micrositio: verifica que el proveedor activo responde y que el motor de audio tiene clave.
// Requiere sesión de admin (verify_jwt activo por defecto).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { ping } from '../whatsapp-webhook/ai.ts'
import { apiKey, construirProveedor } from '../whatsapp-webhook/config.ts'
import { registrarAlerta } from '../whatsapp-webhook/alerts.ts'

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
  const motor = cfg.motor_audio === 'openai' ? 'openai' : 'gemini'
  const audio = { motor, clave_configurada: !!(await apiKey(sb, cfg, motor)) }
  try {
    const prov = await construirProveedor(sb, cfg)
    const t0 = Date.now()
    const r = await ping(prov)
    return json({ ok: true, proveedor: prov.proveedor, modelo: prov.modelo, ms: Date.now() - t0, respuesta: r.slice(0, 40), audio })
  } catch (e) {
    await registrarAlerta(sb, cfg, 'error', String(e))
    return json({ ok: false, error: String(e).slice(0, 400), audio })
  }
})
