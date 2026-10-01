// Sonido de notificaciones del admin (por dispositivo). Se genera con Web Audio: no necesita archivos.
const K = 'mumi_sonido'
export const sonidoActivo = () => { try { return localStorage.getItem(K) === '1' } catch { return false } }
export const setSonidoActivo = (v: boolean) => { try { localStorage.setItem(K, v ? '1' : '0') } catch { /* sin almacenamiento */ } }
let ctx: AudioContext | null = null
// Dos notas cortas (ding-dong). Si el navegador aún no permitió audio, se ignora en silencio.
export function tono(siempre = true) {
  if (!siempre && !sonidoActivo()) return
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    void ctx.resume()
    ;[[880, 0], [660, 0.18]].forEach(([f, t]) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain()
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx!.destination)
      const t0 = ctx!.currentTime + t
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3)
      o.start(t0); o.stop(t0 + 0.32)
    })
  } catch { /* sin audio */ }
}
