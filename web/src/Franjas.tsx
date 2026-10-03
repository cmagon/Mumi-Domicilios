import HoraPicker, { horaBonita12 } from './HoraPicker'
import { useConfig } from './hooks'

// "14:00-16:00" ↔ { de: '14:00', a: '16:00' }
export const parseFranja = (s: string) => { const m = s.trim().match(/^(\d{1,2}):?(\d{2})?\s*-\s*(\d{1,2}):?(\d{2})?$/); return m ? { de: `${m[1].padStart(2, '0')}:${m[2] ?? '00'}`, a: `${m[3].padStart(2, '0')}:${m[4] ?? '00'}` } : { de: '', a: '' } }
export const franjaBonita = (s: string) => { const { de, a } = parseFranja(s); return de && a ? `${horaBonita12(de)} a ${horaBonita12(a)}` : s }
export const listaFranjas = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean)

// Editor de las franjas de entrega (Configuración): cada una con dos selectores de hora en 12 h
export function FranjasEditor({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  const lista = listaFranjas(valor).map(parseFranja)
  const guardar = (l: { de: string; a: string }[]) => onChange(l.filter((x) => x.de && x.a).map((x) => `${x.de}-${x.a}`).join(','))
  const filas = lista.length ? lista : []
  const cambiar = (i: number, k: 'de' | 'a', v: string) => guardar(filas.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  return (
    <div>
      {filas.map((f, i) => (
        <div className="row" key={i} style={{ alignItems: 'center' }}>
          <div style={{ flex: 1 }}><HoraPicker valor={f.de} onChange={(v) => cambiar(i, 'de', v)} placeholder="Desde" limpiable={false} /></div>
          <span className="muted">a</span>
          <div style={{ flex: 1 }}><HoraPicker valor={f.a} onChange={(v) => cambiar(i, 'a', v)} placeholder="Hasta" limpiable={false} /></div>
          <button type="button" className="sec sm" onClick={() => guardar(filas.filter((_, j) => j !== i))} aria-label="Quitar franja">🗑</button>
        </div>))}
      <button type="button" className="sec sm" onClick={() => guardar([...filas, filas.length ? { de: filas[filas.length - 1].a, a: `${String(Math.min(23, +filas[filas.length - 1].a.slice(0, 2) + 2)).padStart(2, '0')}:00` } : { de: '14:00', a: '16:00' }])}>+ Agregar franja</button>
      {!filas.length && <p className="muted">Sin franjas: el bot no ofrecerá horarios de entrega.</p>}
    </div>
  )
}

// Selector de franja de un pedido (opciones de Configuración, mostradas en 12 h; conserva un valor antiguo que ya no esté en la lista)
export function FranjaSelect({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  const { cfg } = useConfig()
  const l = listaFranjas(cfg.franjas_entrega ?? '')
  const extra = valor && !l.includes(valor) ? [valor] : []
  return (
    <select aria-label="Franja horaria" value={valor} onChange={(e) => onChange(e.target.value)}>
      <option value="">— sin franja —</option>
      {[...l, ...extra].map((x) => <option key={x} value={x}>{franjaBonita(x)}</option>)}
    </select>
  )
}
