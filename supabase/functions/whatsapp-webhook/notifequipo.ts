// Notificaciones al equipo en ORDEN: primero el número principal del admin; si no se le puede escribir (su ventana de 24 h de WhatsApp
// está cerrada o WhatsApp falla), se intenta con el secundario, y así. El orden es el de "admin_numeros" (Configuración → Equipo y números).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { sendTemplate, sendText } from './wa.ts'

// Números del equipo en orden (principal primero), solo dígitos y sin repetidos
export const numerosAdmin = (cfg: Record<string, string>): string[] =>
  [...new Set((cfg.admin_numeros ?? '').split(',').map((x) => x.replace(/\D/g, '')).filter(Boolean))]

export async function ventanaAbierta(sb: SupabaseClient, tel: string): Promise<boolean> {
  const { data: ult } = await sb.from('mensajes').select('creado_en').eq('telefono', tel).eq('rol', 'user').order('creado_en', { ascending: false }).limit(1).maybeSingle()
  return !!ult && Date.now() - new Date(ult.creado_en).getTime() < 23.5 * 3600 * 1000
}

// Devuelve el número al que se logró notificar (o null si a ninguno). `template`: plantilla aprobada para cuando la ventana está cerrada.
export async function notificarAdmins(sb: SupabaseClient, cfg: Record<string, string>, texto: string,
  o: { excluir?: string | null; template?: { env: string; params: string[] } } = {}): Promise<string | null> {
  for (const tel of numerosAdmin(cfg)) {
    if (tel === o.excluir) continue
    try {
      let id: string | null = null
      if (await ventanaAbierta(sb, tel)) id = await sendText(tel, texto)
      else if (o.template && Deno.env.get(o.template.env)) id = await sendTemplate(tel, Deno.env.get(o.template.env)!, o.template.params)
      if (id) return tel
    } catch (e) { console.error('notificarAdmins', tel, e) }
  }
  return null
}
