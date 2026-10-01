// Atención humana: si una persona del equipo toma un chat pero tarda más de N minutos en responder al cliente, el bot lo retoma.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

// Minutos máximos que el cliente puede esperar a una persona (config minutos_humano_sin_responder; 0 = desactivado)
export const minutosLimite = (cfg: Record<string, string>) =>
  cfg.minutos_humano_sin_responder === '' || cfg.minutos_humano_sin_responder == null ? 5 : Math.max(0, Number(cfg.minutos_humano_sin_responder) || 0)

// Primer mensaje del cliente que sigue sin respuesta de la persona (posterior a su último mensaje y a que tomó el chat)
export async function mensajePendiente(sb: SupabaseClient, telefono: string, humanoDesde: string | null): Promise<{ creado_en: string } | null> {
  const { data: adm } = await sb.from('mensajes').select('creado_en').eq('telefono', telefono).eq('rol', 'admin').order('creado_en', { ascending: false }).limit(1).maybeSingle()
  const base = Math.max(adm ? new Date(adm.creado_en).getTime() : 0, humanoDesde ? new Date(humanoDesde).getTime() : 0)
  const { data: p } = await sb.from('mensajes').select('creado_en').eq('telefono', telefono).eq('rol', 'user')
    .gt('creado_en', new Date(base).toISOString()).order('creado_en', { ascending: true }).limit(1).maybeSingle()
  return p ?? null
}

export async function humanoTardo(sb: SupabaseClient, cfg: Record<string, string>, telefono: string, humanoDesde: string | null): Promise<boolean> {
  const lim = minutosLimite(cfg)
  if (lim <= 0) return false
  const p = await mensajePendiente(sb, telefono, humanoDesde)
  return !!p && Date.now() - new Date(p.creado_en).getTime() > lim * 60000
}
