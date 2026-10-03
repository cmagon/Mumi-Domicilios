// Forzar la última versión de la app: borra el service worker y la caché del navegador y recarga.
export async function limpiarYRecargar() {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations()
    await Promise.all((regs ?? []).map((r) => r.unregister()))
    const keys = await caches?.keys()
    await Promise.all((keys ?? []).map((k) => caches.delete(k)))
  } catch { /* ignorar */ }
  location.reload()
}

// Actualización automática: busca una versión nueva cada minuto y al volver a la app; cuando hay una, la activa y recarga una sola vez.
export function activarActualizacionAutomatica(registrarSW: (o: { immediate: boolean; onRegisteredSW: (url: string, r?: ServiceWorkerRegistration) => void; onNeedRefresh: () => void }) => (recargar?: boolean) => Promise<void>) {
  if (!('serviceWorker' in navigator)) return
  const habiaControlador = !!navigator.serviceWorker.controller
  let recargado = false
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (habiaControlador && !recargado) { recargado = true; location.reload() } })
  const actualizar = registrarSW({
    immediate: true,
    onRegisteredSW: (_url, r) => {
      if (!r) return
      const buscar = () => { if (!document.hidden) void r.update().catch(() => {}) }
      setInterval(buscar, 60_000)
      document.addEventListener('visibilitychange', buscar)
      window.addEventListener('online', buscar)
    },
    onNeedRefresh: () => { void actualizar(true) },
  })
}
