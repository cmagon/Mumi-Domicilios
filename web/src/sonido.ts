// Sonido de notificaciones del admin (por dispositivo). Se genera con Web Audio: no necesita archivos.
const K = 'mumi_sonido'
export const sonidoActivo = () => { try { return localStorage.getItem(K) === '1' } catch { return false } }
export const setSonidoActivo = (v: boolean) => { try { localStorage.setItem(K, v ? '1' : '0') } catch { /* sin almacenamiento */ } }
let ctx: AudioContext | null = null
const nuevoCtx = () => (ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)())
// Los móviles (iOS/Android) solo permiten audio tras un toque del usuario: se "desbloquea" con el primer gesto en la app.
export function desbloquearAudio() {
  const f = () => { try { const c = nuevoCtx(); void c.resume(); const o = c.createOscillator(), g = c.createGain(); g.gain.value = 0.0001; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.01) } catch { /* sin audio */ } ;['touchend', 'click', 'keydown'].forEach((e) => window.removeEventListener(e, f)) }
  ;['touchend', 'click', 'keydown'].forEach((e) => window.addEventListener(e, f, { once: false, passive: true }))
}
// Vibración corta (Android) como refuerzo cuando el sonido no suena
export const vibrar = () => { try { navigator.vibrate?.([120, 60, 120]) } catch { /* no soportado */ } }
// Dos notas cortas (ding-dong). Si el navegador aún no permitió audio, se ignora en silencio.
export function tono(siempre = true) {
  if (!siempre && !sonidoActivo()) return
  try {
    nuevoCtx(); void ctx!.resume(); vibrar()
    ;[[880, 0], [660, 0.18]].forEach(([f, t]) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain()
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx!.destination)
      const t0 = ctx!.currentTime + t
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3)
      o.start(t0); o.stop(t0 + 0.32)
    })
  } catch { /* sin audio */ }
}
