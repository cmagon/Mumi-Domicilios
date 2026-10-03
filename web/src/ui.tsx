import { createPortal } from 'react-dom'
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Info as InfoIcon, X as XIcon } from 'lucide-react'

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
const pilaModales: object[] = [] // solo el modal de más arriba reacciona a Esc (un Confirmar sobre otro modal no cierra los dos)
const ENFOCABLES = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
export function Modal({ abierto, titulo, onClose, children, pie, ancho = 480 }: {
  abierto: boolean; titulo: string; onClose: () => void; children: ReactNode; pie?: ReactNode; ancho?: number
}) {
  const caja = useRef<HTMLDivElement>(null)
  const tituloId = useId()
  const cerrarRef = useRef(onClose); cerrarRef.current = onClose
  useEffect(() => {
    if (!abierto) return
    const yo = {}; pilaModales.push(yo)
    const previo = document.activeElement as HTMLElement | null
    const tecla = (e: KeyboardEvent) => {
      if (pilaModales[pilaModales.length - 1] !== yo) return
      if (e.key === 'Escape') { cerrarRef.current(); return }
      if (e.key === 'Tab' && caja.current) { // el foco se queda dentro del modal
        const l = [...caja.current.querySelectorAll<HTMLElement>(ENFOCABLES)]
        if (!l.length) return
        const a = document.activeElement
        if (e.shiftKey && (a === l[0] || a === caja.current)) { e.preventDefault(); l[l.length - 1].focus() }
        else if (!e.shiftKey && a === l[l.length - 1]) { e.preventDefault(); l[0].focus() }
      }
    }
    window.addEventListener('keydown', tecla)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    if (!caja.current?.contains(document.activeElement)) caja.current?.focus()
    return () => { window.removeEventListener('keydown', tecla); document.body.style.overflow = prev; pilaModales.splice(pilaModales.indexOf(yo), 1); previo?.focus?.() }
  }, [abierto])
  if (!abierto) return null
  // Se pinta en <body>: así ningún contenedor con animaciones/transform lo desplaza o recorta
  return createPortal(
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" ref={caja} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={tituloId} style={{ maxWidth: ancho }}>
        <div className="modal-cab"><h2 id={tituloId}>{titulo}</h2><button className="sec sm cerrar" onClick={onClose} aria-label="Cerrar"><XIcon size={18} aria-hidden /></button></div>
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
    <label className="switch-fila" onClick={(e) => { e.preventDefault(); onChange(!checked) }}>
      <span className={`switch ${checked ? 'on' : ''} ${color ?? ''}`} role="switch" aria-checked={checked} aria-label={label} tabIndex={0}
        onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), onChange(!checked))}><span className="perilla" /></span>
      {label && <span>{label}</span>}
    </label>
  )
}

// ---------- Ayuda en un botón "i": los textos largos de instrucciones van aquí, no a la vista ----------
// Se abre como una tarjeta flotante (portal) que se acomoda dentro de la pantalla; se cierra con Esc, tocando fuera o al desplazarse.
export function Info({ children, bloque = false, titulo = 'Ayuda' }: { children: ReactNode; bloque?: boolean; titulo?: string }) {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; w: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const id = useId()
  const cerrar = useCallback(() => setPos(null), [])
  useEffect(() => {
    if (!pos) return
    const fuera = (e: Event) => { if (!(e.target as HTMLElement).closest?.(`[data-info="${CSS.escape(id)}"]`) && !btn.current?.contains(e.target as Node)) cerrar() }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(); btn.current?.focus() } } // Esc cierra solo la ayuda, no el modal que la contiene
    document.addEventListener('pointerdown', fuera); document.addEventListener('keydown', tecla)
    window.addEventListener('resize', cerrar); window.addEventListener('scroll', cerrar, true)
    return () => { document.removeEventListener('pointerdown', fuera); document.removeEventListener('keydown', tecla); window.removeEventListener('resize', cerrar); window.removeEventListener('scroll', cerrar, true) }
  }, [pos, id, cerrar])
  const abrir = () => {
    if (pos) return cerrar()
    const r = btn.current!.getBoundingClientRect(), w = Math.min(340, window.innerWidth - 24)
    const left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12))
    setPos(r.bottom > window.innerHeight * 0.6 ? { bottom: window.innerHeight - r.top + 6, left, w } : { top: r.bottom + 6, left, w })
  }
  return (
    <>
      <button ref={btn} type="button" className={`info-btn ${bloque ? 'bloque' : ''}`} aria-label={titulo} aria-expanded={!!pos} aria-controls={id} onClick={abrir}>
        <InfoIcon size={bloque ? 16 : 18} aria-hidden />{bloque && <span>{titulo}</span>}
      </button>
      {pos && createPortal(
        <div id={id} data-info={id} role="dialog" aria-modal="false" aria-label={titulo} className="info-pop" style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.w }}>{children}</div>, document.body)}
    </>
  )
}
