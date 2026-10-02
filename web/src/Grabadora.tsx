import { useEffect, useRef, useState } from 'react'
import { Mp3Encoder } from '@breezystack/lamejs'

// Graba una nota de voz en el navegador y la convierte a MP3 (WhatsApp no acepta WebM). Devuelve el audio listo para enviar.
async function aMp3(blob: Blob): Promise<Blob> {
  const ac = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  const buf = await ac.decodeAudioData(await blob.arrayBuffer()); void ac.close()
  const datos = buf.getChannelData(0)
  const pcm = new Int16Array(datos.length)
  for (let i = 0; i < datos.length; i++) pcm[i] = Math.max(-1, Math.min(1, datos[i])) * 0x7fff
  const enc = new Mp3Encoder(1, buf.sampleRate, 64)
  const partes: Uint8Array[] = []
  for (let i = 0; i < pcm.length; i += 1152) { const p = enc.encodeBuffer(pcm.subarray(i, i + 1152)); if (p.length) partes.push(new Uint8Array(p)) }
  const fin = enc.flush(); if (fin.length) partes.push(new Uint8Array(fin))
  return new Blob(partes as BlobPart[], { type: 'audio/mpeg' })
}

export default function Grabadora({ onListo, onError }: { onListo: (mp3: Blob, url: string) => void; onError: (m: string) => void }) {
  const [grabando, setGrabando] = useState(false)
  const [seg, setSeg] = useState(0)
  const rec = useRef<MediaRecorder | null>(null)
  const trozos = useRef<Blob[]>([])
  const t = useRef<number | undefined>(undefined)
  useEffect(() => () => { window.clearInterval(t.current); rec.current?.stream.getTracks().forEach((x) => x.stop()) }, [])

  const iniciar = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const r = new MediaRecorder(stream); trozos.current = []
      r.ondataavailable = (e) => e.data.size && trozos.current.push(e.data)
      r.onstop = async () => {
        stream.getTracks().forEach((x) => x.stop())
        try { const mp3 = await aMp3(new Blob(trozos.current, { type: r.mimeType || 'audio/webm' })); onListo(mp3, URL.createObjectURL(mp3)) } catch { onError('No se pudo procesar el audio') }
      }
      r.start(); rec.current = r; setSeg(0); setGrabando(true)
      t.current = window.setInterval(() => setSeg((s) => { if (s >= 179) { detener(); } return s + 1 }), 1000)
    } catch { onError('No se pudo usar el micrófono (permite el acceso en el navegador)') }
  }
  const detener = () => { window.clearInterval(t.current); setGrabando(false); if (rec.current?.state === 'recording') rec.current.stop() }
  const cancelar = () => { window.clearInterval(t.current); setGrabando(false); if (rec.current) { rec.current.onstop = () => rec.current?.stream.getTracks().forEach((x) => x.stop()); if (rec.current.state === 'recording') rec.current.stop() } }

  return grabando
    ? <div className="grabando"><button className="sec adjuntar" onClick={cancelar} aria-label="Cancelar">✕</button><span className="rec-punto" /> {Math.floor(seg / 60)}:{String(seg % 60).padStart(2, '0')}<button className="adjuntar" onClick={detener} aria-label="Enviar nota de voz" title="Enviar">➤</button></div>
    : <button className="sec adjuntar" onClick={iniciar} aria-label="Grabar nota de voz" title="Grabar nota de voz">🎤</button>
}
