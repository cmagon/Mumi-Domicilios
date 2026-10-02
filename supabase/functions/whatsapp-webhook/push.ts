// Notificaciones push (Web Push / VAPID) a los dispositivos del admin: llegan aunque la app esté cerrada o en segundo plano.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const deb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

// Devuelve las claves VAPID; si no existen las genera y las guarda (así no hay que configurar nada a mano).
export async function claves(sb: SupabaseClient): Promise<{ publica: string; privada: string }> {
  const { data } = await sb.from('push_claves').select('publica,privada').eq('id', 1).maybeSingle()
  if (data) return data
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', k.privateKey)
  const pub = new Uint8Array([4, ...deb64u(jwk.x!), ...deb64u(jwk.y!)])
  const nuevo = { id: 1, publica: b64u(pub), privada: jwk.d! }
  await sb.from('push_claves').upsert(nuevo, { onConflict: 'id', ignoreDuplicates: true })
  const { data: fin } = await sb.from('push_claves').select('publica,privada').eq('id', 1).maybeSingle()
  return fin ?? nuevo
}

// Envía a todos los dispositivos suscritos; borra los que ya no existen (404/410). Nunca lanza error.
export async function pushAdmin(sb: SupabaseClient, titulo: string, cuerpo: string, extra: { tag?: string; url?: string } = {}) {
  try {
    const { data: subs } = await sb.from('push_suscripciones').select('endpoint,p256dh,auth')
    if (!subs?.length) return
    const c = await claves(sb)
    webpush.setVapidDetails('mailto:admin@mumi.local', c.publica, c.privada)
    // Número de chats por revisar: se muestra en el ícono de la app instalada
    const { count } = await sb.from('chats_bandeja').select('telefono', { count: 'exact', head: true }).or('avisos.gt.0,no_leidos.gt.0')
    const payload = JSON.stringify({ titulo, cuerpo: cuerpo.slice(0, 160), tag: extra.tag ?? 'mumi', url: extra.url ?? '/chats', badge: count ?? undefined })
    await Promise.all(subs.map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 }) }
      catch (e) { if ([404, 410].includes((e as { statusCode?: number }).statusCode ?? 0)) await sb.from('push_suscripciones').delete().eq('endpoint', s.endpoint) }
    }))
  } catch (e) { console.error('pushAdmin', e) }
}
