import { createPortal } from 'react-dom'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

// ---------- Toasts (avisos que se deslizan al guardar/editar) ----------
type Tipo = 'ok' | 'err' | 'info'
type Toast = { id: number; texto: string; tipo: Tipo }
const ToastCtx = createContext<(texto: string, tipo?: Tipo) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const n = useRef(0)
  const push = useCallback((texto: string, tipo: Tipo = 'ok') => {
    const id = ++n.current
    setItems((t) => [...t.slice(-3), { id, texto, tipo }])
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), tipo === 'err' ? 5000 : 2600)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.tipo}`}><span className="toast-ico">{t.tipo === 'ok' ? '✓' : t.tipo === 'err' ? '!' : 'i'}</span>{t.texto}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}

// ---------- Botón con estados: cargando → ✓ guardado / ✕ error ----------
// onClick puede devolver false para indicar que falló (validación) sin animación de éxito.
export function AsyncButton({ onClick, children, okText = 'Listo', className = '', disabled, type = 'button' }: {
  onClick: () => Promise<boolean | void | 'omitir'> | boolean | void | 'omitir'; children: ReactNode; okText?: string; className?: string; disabled?: boolean; type?: 'button' | 'submit'
}) {
  const [st, setSt] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const vivo = useRef(true)
  useEffect(() => () => { vivo.current = false }, [])
  const click = async () => {
    if (st !== 'idle') return
    setSt('loading')
    let res: boolean | void | 'omitir' = true
    try { res = await onClick() } catch { res = false }
    if (!vivo.current) return
    if (res === 'omitir') { setSt('idle'); return }
    setSt(res === false ? 'err' : 'ok')
    setTimeout(() => vivo.current && setSt('idle'), res === false ? 1300 : 1100)
  }
  return (
    <button type={type} className={`${className} abtn ${st}`} disabled={disabled || st === 'loading'} onClick={click}>
      {st === 'loading' && <span className="spin" />}
      {st === 'ok' && <span className="tick">✓</span>}
      {st === 'err' && <span className="tick">✕</span>}
      <span className={st === 'idle' || st === 'loading' ? '' : 'sr'}>{children}</span>
      {st === 'ok' && <span>{okText}</span>}
    </button>
  )
}

// ---------- Modal ----------
export function Modal({ abierto, titulo, onClose, children, pie, ancho = 480 }: {
  abierto: boolean; titulo: string; onClose: () => void; children: ReactNode; pie?: ReactNode; ancho?: number
}) {
  useEffect(() => {
    if (!abierto) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = prev }
  }, [abierto, onClose])
  if (!abierto) return null
  // Se pinta en <body>: así ningún contenedor con animaciones/transform lo desplaza o recorta
  return createPortal(
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: ancho }}>
        <div className="modal-cab"><h2>{titulo}</h2><button className="sec sm cerrar" onClick={onClose} aria-label="Cerrar">✕</button></div>
        <div className="modal-cuerpo">{children}</div>
        {pie && <div className="modal-pie">{pie}</div>}
      </div>
    </div>, document.body)
}

// ---------- Confirmación ----------
export type Confirmacion = { titulo: string; texto: ReactNode; okText?: string; peligro?: boolean; onOk: () => Promise<boolean | void> | boolean | void }
export function Confirmar({ c, onClose }: { c: Confirmacion | null; onClose: () => void }) {
  return (
    <Modal abierto={!!c} titulo={c?.titulo ?? ''} onClose={onClose} ancho={400}
      pie={c && <>
        <button className="sec" onClick={onClose}>Cancelar</button>
        <AsyncButton className={c.peligro ? 'peligro' : ''} okText="Hecho" onClick={async () => { const r = await c.onOk(); if (r !== false) setTimeout(onClose, 500); return r }}>{c.okText ?? 'Confirmar'}</AsyncButton>
      </>}>
      <div>{c?.texto}</div>
    </Modal>
  )
}

// ---------- Interruptor ----------
export function Switch({ checked, onChange, label, color }: { checked: boolean; onChange: (v: boolean) => void; label?: string; color?: 'verde' }) {
  return (
    <label className="switch-fila">
      <span className={`switch ${checked ? 'on' : ''} ${color ?? ''}`} role="switch" aria-checked={checked} tabIndex={0}
        onClick={() => onChange(!checked)} onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), onChange(!checked))}><span className="perilla" /></span>
      {label && <span>{label}</span>}
    </label>
  )
}
