/// <reference lib="webworker" />
// Service worker: caché de la app (PWA) + notificaciones push en la barra de tareas, también con la app cerrada.
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope
self.skipWaiting()
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

self.addEventListener('push', (e) => {
  let d: { titulo?: string; cuerpo?: string; tag?: string; url?: string } = {}
  try { d = e.data?.json() ?? {} } catch { d = { cuerpo: e.data?.text() } }
  e.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // La app ya está a la vista: ahí suena y se actualiza sola; no duplicar la notificación
    if (abiertas.some((c) => c.visibilityState === 'visible' && c.focused)) { abiertas.forEach((c) => c.postMessage({ tipo: 'push' })); return }
    await self.registration.showNotification(d.titulo || 'Mumi', {
      body: d.cuerpo || '', tag: d.tag || 'mumi', icon: '/favicon.svg', badge: '/favicon.svg',
      data: { url: d.url || '/chats' }, vibrate: [200, 100, 200], renotify: true,
    } as NotificationOptions)
  })())
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data as { url?: string } | undefined)?.url || '/chats'
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const w = wins[0]
    if (w) { await w.focus(); w.postMessage({ tipo: 'abrir', url }); return }
    await self.clients.openWindow(url)
  })())
})
