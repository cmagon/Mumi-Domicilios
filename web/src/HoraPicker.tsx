import { useState } from 'react'
import { Modal } from './ui'

export const horaBonita12 = (v: string) => {
  if (!v) return ''
  const [h, m] = v.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'p. m.' : 'a. m.'}`
}
const HORAS = Array.from({ length: 18 }, (_, i) => i + 5) // 5 a. m. → 10 p. m.
const MIN = ['00', '15', '30', '45']

// Selector de hora en 12 h: primero la hora (botones grandes), luego los minutos. Valor 'HH:MM' o ''.
export default function HoraPicker({ valor, onChange, placeholder = 'Elegir hora', limpiable = true }: { valor: string; onChange: (v: string) => void; placeholder?: string; limpiable?: boolean }) {
  const [abierto, setAbierto] = useState(false)
  const [h, setH] = useState<number | null>(null)
  const abrir = () => { setH(valor ? Number(valor.split(':')[0]) : null); setAbierto(true) }
  const elegir = (m: string) => { onChange(`${String(h).padStart(2, '0')}:${m}`); setAbierto(false) }
  return (
    <>
      <button type="button" className="sec selector-fecha" style={{ textTransform: 'none' }} onClick={abrir}>🕒 {valor ? horaBonita12(valor) : placeholder}</button>
      <Modal abierto={abierto} titulo={h == null ? 'Elige la hora' : `${h % 12 || 12} ${h >= 12 ? 'p. m.' : 'a. m.'} · ¿y los minutos?`} onClose={() => setAbierto(false)} ancho={360}
        pie={limpiable && valor ? <button className="sec" onClick={() => { onChange(''); setAbierto(false) }}>Quitar hora</button> : undefined}>
        {h == null ? (
          <div className="hora-grid">
            {HORAS.map((x) => <button key={x} className={`chip ${valor && Number(valor.split(':')[0]) === x ? 'on' : ''}`} onClick={() => setH(x)}>{x % 12 || 12}<small>{x >= 12 ? ' p. m.' : ' a. m.'}</small></button>)}
          </div>
        ) : (
          <>
            <div className="hora-grid">{MIN.map((m) => <button key={m} className="chip" onClick={() => elegir(m)}>{h % 12 || 12}:{m}</button>)}</div>
            <button className="ghost" onClick={() => setH(null)}>← Cambiar la hora</button>
          </>)}
      </Modal>
    </>
  )
}
