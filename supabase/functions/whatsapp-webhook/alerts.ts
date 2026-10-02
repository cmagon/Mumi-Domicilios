// Alertas de fallos de IA: se guardan en `alertas_ia` (banner en el micrositio) y se avisan por WhatsApp y correo (opcional).
import { notificarAdmins } from './notifequipo.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { sendText } from './wa.ts'

export type TipoAlerta = 'cuota' | 'clave' | 'audio' | 'error'

export function clasificar(mensaje: string): TipoAlerta {
  const m = mensaje.toLowerCase()
  if (/\b(429|402)\b|quota|credit balance|insufficient|rate limit|resource_exhausted/.test(m)) return 'cuota'
  if (/\b(401|403)\b|api key|api_key|permission|unauthorized|invalid x-api-key|no configurada/.test(m)) return 'clave'
  return 'error'
}

const TITULO: Record<TipoAlerta, string> = {
  cuota: 'Se acabó el saldo o el límite del proveedor de IA',
  clave: 'La API key de IA es inválida o falta',
  audio: 'Falló la transcripción de una nota de voz',
  error: 'Error del proveedor de IA',
}

export async function registrarAlerta(sb: SupabaseClient, cfg: Record<string, string>, tipoBase: TipoAlerta, detalle: string) {
  try {
    const tipo = tipoBase === 'audio' ? 'audio' : clasificar(detalle)
    const texto = detalle.replace(/(key|token)=?[A-Za-z0-9_\-]{20,}/gi, '$1=***').slice(0, 500)
    // Evita avisar más de una vez cada 30 min por tipo
    const desde = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { count } = await sb.from('alertas_ia').select('id', { count: 'exact', head: true }).eq('tipo', tipo).eq('notificada', true).gte('creado_en', desde)
    const notificar = !count
    await sb.from('alertas_ia').insert({ tipo, detalle: texto, notificada: notificar })
    if (!notificar) return
    const msg = `⚠️ Bot Mumi: ${TITULO[tipo]}.\n${texto.slice(0, 200)}\nRevisa Configuración → "Probar IA" en el micrositio.`
    // WhatsApp (solo llega si el admin escribió al bot en las últimas 24 h)
    await notificarAdmins(sb, cfg, msg) // principal primero; si no se le puede escribir, el secundario
    // Correo opcional (Resend): secrets RESEND_API_KEY y ALERT_EMAIL_TO
    const key = Deno.env.get('RESEND_API_KEY'), to = Deno.env.get('ALERT_EMAIL_TO')
    if (key && to) {
      await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: Deno.env.get('ALERT_EMAIL_FROM') ?? 'Mumi Bot <onboarding@resend.dev>', to: to.split(',').map((x) => x.trim()),
          subject: `⚠️ Bot Mumi: ${TITULO[tipo]}`, text: msg }) })
    }
  } catch (e) { console.error('registrarAlerta', e) }
}
