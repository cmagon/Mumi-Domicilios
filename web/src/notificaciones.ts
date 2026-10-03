// Notificaciones push del admin (segundo plano / barra de tareas) por dispositivo.
import { supabase } from './supabase'

const b64 = (s: string) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)) }

export const pushSoportado = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export const instaladaIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator as unknown as { standalone?: boolean }).standalone && !matchMedia('(display-mode: standalone)').matches

export async function suscripcionActual() {
  if (!pushSoportado()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

export async function activarPush(): Promise<{ ok: boolean; error?: string }> {
  if (!pushSoportado()) return { ok: false, error: instaladaIOS() ? 'En iPhone/iPad instala primero la app: Compartir → "Añadir a pantalla de inicio" y ábrela desde ahí.' : 'Este navegador no admite notificaciones push.' }
  if ((await Notification.requestPermission()) !== 'granted') return { ok: false, error: 'No diste permiso de notificaciones (revisa los permisos del sitio en el navegador).' }
  const reg = await navigator.serviceWorker.ready
  const { data, error } = await supabase.functions.invoke('push-clave')
  if (error || !data?.ok) return { ok: false, error: data?.error ?? 'No se pudo obtener la clave (¿desplegaste la función push-clave?).' }
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(data.publica) })
  const j = sub.toJSON()
  const { data: u } = await supabase.auth.getUser()
  const { error: e2 } = await supabase.from('push_suscripciones').upsert({ endpoint: sub.endpoint, user_id: u.user?.id, p256dh: j.keys!.p256dh, auth: j.keys!.auth }, { onConflict: 'endpoint' })
  return e2 ? { ok: false, error: `No se guardó la suscripción: ${e2.message} (¿corriste la migración 0040?)` } : { ok: true }
}

export async function desactivarPush() {
  const s = await suscripcionActual()
  if (!s) return
  await supabase.from('push_suscripciones').delete().eq('endpoint', s.endpoint)
  await s.unsubscribe()
}

// Notificación del sistema desde la página. En Android (Chrome) `new Notification()` lanza error: se usa el service worker; nunca debe romper la app.
export async function avisoLocal(titulo: string, cuerpo: string) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
    if (reg) { await reg.showNotification(titulo, { body: cuerpo, icon: '/favicon.svg', tag: 'mumi' }); return }
    new Notification(titulo, { body: cuerpo })
  } catch { /* sin notificaciones del sistema */ }
}
