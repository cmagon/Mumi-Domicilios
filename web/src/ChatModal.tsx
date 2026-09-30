import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { Modal } from './ui'

type Msg = { id: string; rol: 'user' | 'assistant'; contenido: string; creado_en: string }

// Conversación completa de un cliente (burbujas tipo WhatsApp). desde/hasta limitan a una sesión.
export default function ChatModal({ telefono, titulo, desde, hasta, onClose, extra }: {
  telefono: string | null; titulo: string; desde?: string; hasta?: string; onClose: () => void; extra?: React.ReactNode
}) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [cargando, setCargando] = useState(false)
  const fin = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!telefono) return
    setCargando(true)
    let q = supabase.from('mensajes').select('id,rol,contenido,creado_en').eq('telefono', telefono).order('creado_en', { ascending: true }).limit(500)
    if (desde) q = q.gte('creado_en', desde)
    if (hasta) q = q.lte('creado_en', hasta)
    q.then(({ data }) => { setMsgs((data ?? []) as Msg[]); setCargando(false) })
  }, [telefono, desde, hasta])
  useEffect(() => { fin.current?.scrollIntoView() }, [msgs])

  let diaPrev = ''
  return (
    <Modal abierto={!!telefono} titulo={titulo} onClose={onClose} ancho={560}>
      {extra}
      <div className="chat">
        {cargando && <p className="muted">Cargando conversación…</p>}
        {!cargando && !msgs.length && <p className="muted">No hay mensajes guardados de este cliente.</p>}
        {msgs.map((m) => {
          const d = new Date(m.creado_en)
          const dia = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
          const sep = dia !== diaPrev; diaPrev = dia
          const nota = /^\[.*\]$/.test(m.contenido.trim())
          return (
            <div key={m.id}>
              {sep && <div className="chat-dia">{dia}</div>}
              <div className={`burbuja ${m.rol === 'user' ? 'cli' : 'bot'} ${nota ? 'nota' : ''}`}>
                {m.contenido}
                <span className="hora">{d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}</span>
              </div>
            </div>)
        })}
        <div ref={fin} />
      </div>
    </Modal>
  )
}
