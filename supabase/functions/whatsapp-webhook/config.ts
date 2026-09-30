import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { modeloPorDefecto, type Provider, type Proveedor } from './ai.ts'

// Cada proveedor tiene su propia API key (secretos key_claude / key_openai / key_gemini);
// ia_api_key se conserva como respaldo para el proveedor activo.
export async function apiKey(sb: SupabaseClient, cfg: Record<string, string>, p: Proveedor): Promise<string | null> {
  const { data } = await sb.from('config_secretos').select('clave,valor').in('clave', [`key_${p}`, 'ia_api_key'])
  const propia = data?.find((r) => r.clave === `key_${p}`)?.valor
  if (propia) return propia
  if (p === (cfg.proveedor_ia || 'claude')) return data?.find((r) => r.clave === 'ia_api_key')?.valor ?? null
  return p === 'openai' ? (Deno.env.get('OPENAI_API_KEY') ?? null) : null
}

export const proveedorActivo = (cfg: Record<string, string>): Proveedor =>
  (['claude', 'openai', 'gemini'].includes(cfg.proveedor_ia) ? cfg.proveedor_ia : 'claude') as Proveedor

export async function construirProveedor(sb: SupabaseClient, cfg: Record<string, string>): Promise<Provider> {
  const p = proveedorActivo(cfg)
  const key = await apiKey(sb, cfg, p)
  if (!key) throw new Error(`API key de ${p} no configurada`)
  return { proveedor: p, apiKey: key, modelo: cfg.modelo_ia || modeloPorDefecto(p) }
}
