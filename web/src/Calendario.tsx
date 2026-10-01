import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { hoy, useConfig } from './hooks'
import { AsyncButton, Modal, useToast } from './ui'

type Excep = { fecha: string; tipo: 'produccion' | 'cerrado'; nota: string | null }
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
const sinAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const iso = (d: Date) => d.toLocaleDateString('en-CA')
const suma = (f: string, n: number) => iso(new Date(new Date(f + 'T12:00:00').getTime() + n * 86400000))
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// Días de producción = días de la semana de Configuración + excepciones del calendario (extra / cerrado)
export function useCalendario() {
  const { cfg } = useConfig()
  const [ex, setEx] = useState<Excep[]>([])
  const cargar = useCallback(async () => {
    const { data } = await supabase.from('calendario_produccion').select('fecha,tipo,nota').gte('fecha', hoy()).order('fecha')
    setEx((data ?? []) as Excep[])
  }, [])
  useEffect(() => { cargar() }, [cargar])
  const semana = useMemo(() => (cfg.dias_produccion ?? '').split(',').map((d) => sinAcento(d.trim())).filter(Boolean), [cfg.dias_produccion])
  const mapa = useMemo(() => new Map(ex.map((e) => [e.fecha, e])), [ex])
  const regular = useCallback((f: string) => semana.includes(DIAS[new Date(f + 'T12:00:00').getDay()]), [semana])
  const esProduccion = useCallback((f: string) => { const e = mapa.get(f); return e ? e.tipo === 'produccion' : regular(f) }, [mapa, regular])
  // Primera fecha de producción desde `desde` (incluida) y nunca anterior a hoy
  const ajustar = useCallback((desde: string) => {
    let f = desde < hoy() ? hoy() : desde
    for (let i = 0; i < 120; i++, f = suma(f, 1)) if (esProduccion(f)) return f
    return desde < hoy() ? hoy() : desde
  }, [esProduccion])
  return { cargando: !cfg.dias_produccion, ex, mapa, regular, esProduccion, ajustar, recargar: cargar }
}

function Mes({ mes, setMes, celda }: { mes: Date; setMes: (d: Date) => void; celda: (f: string) => { clase: string; deshab: boolean; onClick: () => void } }) {
  const primero = new Date(mes.getFullYear(), mes.getMonth(), 1)
  const vacios = (primero.getDay() + 6) % 7 // semana desde lunes
  const dias = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate()
  const mesActual = new Date(); const enPasado = mes.getFullYear() === mesActual.getFullYear() && mes.getMonth() <= mesActual.getMonth()
  return (
    <div className="cal">
      <div className="cal-nav">
        <button className="ghost" disabled={enPasado} onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}>‹</button>
        <b style={{ textTransform: 'capitalize' }}>{MESES[mes.getMonth()]} {mes.getFullYear()}</b>
        <button className="ghost" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}>›</button>
      </div>
      <div className="cal-grid">
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => <span key={i} className="cal-sem">{d}</span>)}
        {Array.from({ length: vacios }, (_, i) => <span key={'v' + i} />)}
        {Array.from({ length: dias }, (_, i) => {
          const f = iso(new Date(mes.getFullYear(), mes.getMonth(), i + 1))
          const c = celda(f)
          return <button key={f} className={`cal-dia ${c.clase} ${f === hoy() ? 'hoy' : ''}`} disabled={c.deshab} onClick={c.onClick}>{i + 1}</button>
        })}
      </div>
    </div>
  )
}

// Selector de fecha: solo se pueden elegir días de producción de hoy en adelante
export function SelectorFecha({ valor, onChange, etiqueta }: { valor: string; onChange: (f: string) => void; etiqueta?: string }) {
  const cal = useCalendario()
  const [abierto, setAbierto] = useState(false)
  const [mes, setMes] = useState(new Date((valor || hoy()) + 'T12:00:00'))
  const bonita = valor ? new Date(valor + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Elegir fecha'
  return (
    <>
      <button type="button" className="sec selector-fecha" onClick={() => { setMes(new Date((valor || hoy()) + 'T12:00:00')); setAbierto(true) }}>📅 {etiqueta ?? bonita}</button>
      <Modal abierto={abierto} titulo="Elige el día de producción" onClose={() => setAbierto(false)} ancho={380}>
        <Mes mes={mes} setMes={setMes} celda={(f) => {
          const ok = f >= hoy() && cal.esProduccion(f)
          const e = cal.mapa.get(f)
          return { clase: `${ok ? 'prod' : ''} ${f === valor ? 'sel' : ''} ${e?.tipo === 'cerrado' ? 'cerrado' : ''}`, deshab: !ok, onClick: () => { onChange(f); setAbierto(false) } }
        }} />
        <p className="muted">Solo se pueden elegir los días de producción (en verde). Los días cerrados o pasados no están disponibles.</p>
      </Modal>
    </>
  )
}

// Calendario para marcar días extra de producción o días cerrados (feria, evento…)
export function CalendarioGestion({ abierto, onClose, onCambio }: { abierto: boolean; onClose: () => void; onCambio?: () => void }) {
  const toast = useToast()
  const cal = useCalendario()
  const [mes, setMes] = useState(new Date())
  const [sel, setSel] = useState<string | null>(null)
  const [nota, setNota] = useState('')
  const [pedidos, setPedidos] = useState(0)
  const e = sel ? cal.mapa.get(sel) : undefined
  useEffect(() => {
    if (!sel) return
    setNota(cal.mapa.get(sel)?.nota ?? '')
    supabase.from('pedidos').select('id', { count: 'exact', head: true }).eq('fecha_entrega', sel).not('estado', 'in', '(cancelado,entregado)').then(({ count }) => setPedidos(count ?? 0))
  }, [sel]) // eslint-disable-line
  const guardar = async (tipo: 'produccion' | 'cerrado' | null) => {
    if (!sel) return false
    const { error } = tipo
      ? await supabase.from('calendario_produccion').upsert({ fecha: sel, tipo, nota: nota.trim() || null }, { onConflict: 'fecha' })
      : await supabase.from('calendario_produccion').delete().eq('fecha', sel)
    if (error) { toast(error.message, 'err'); return false }
    await cal.recargar(); onCambio?.()
    toast(tipo === 'cerrado' ? 'Día marcado como cerrado: el bot no agenda ese día' : tipo === 'produccion' ? 'Día de producción agregado' : 'Día restablecido')
  }
  const regular = sel ? cal.regular(sel) : false
  return (
    <Modal abierto={abierto} titulo="📅 Calendario de producción" onClose={onClose} ancho={420}>
      <Mes mes={mes} setMes={setMes} celda={(f) => {
        const x = cal.mapa.get(f)
        return { clase: `${f < hoy() ? 'pasado' : ''} ${x?.tipo === 'cerrado' ? 'cerrado' : cal.esProduccion(f) ? (x ? 'extra' : 'prod') : ''} ${f === sel ? 'sel' : ''}`, deshab: f < hoy(), onClick: () => setSel(f) }
      }} />
      <div className="cal-leyenda"><span><i className="prod" /> Producción</span><span><i className="extra" /> Producción extra</span><span><i className="cerrado" /> Cerrado</span></div>
      {sel ? (
        <div className="cal-sheet">
          <b>{new Date(sel + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}</b>
          <div className="muted">{e ? (e.tipo === 'cerrado' ? 'Cerrado' : 'Producción extra') : regular ? 'Día de producción habitual' : 'Sin producción'}{e?.nota ? ` · ${e.nota}` : ''}</div>
          {pedidos > 0 && <div className="aviso-pedidos">⚠️ Hay {pedidos} pedido{pedidos > 1 ? 's' : ''} activo{pedidos > 1 ? 's' : ''} para ese día: avísales o reprográmalos si lo cierras.</div>}
          <label>Nota (el bot puede decir el motivo a los clientes)</label>
          <input placeholder="ej. Feria en el parque, evento privado, descanso" value={nota} onChange={(x) => setNota(x.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            {e?.tipo === 'cerrado' ? <AsyncButton okText="Reabierto" onClick={() => guardar(null)}>↩ Reabrir este día</AsyncButton>
              : e?.tipo === 'produccion' ? <AsyncButton className="sec" okText="Quitado" onClick={() => guardar(null)}>Quitar producción extra</AsyncButton>
              : regular ? <AsyncButton className="peligro" okText="Cerrado" onClick={() => guardar('cerrado')}>🚫 Cerrar este día</AsyncButton>
              : <AsyncButton okText="Agregado" onClick={() => guardar('produccion')}>➕ Marcar como día de producción</AsyncButton>}
            {e && <AsyncButton className="sec" okText="Guardado" onClick={() => guardar(e.tipo)}>Guardar nota</AsyncButton>}
          </div>
        </div>
      ) : <p className="muted">Toca un día para cerrarlo (feria, evento…) o agregar una producción extra.</p>}
    </Modal>
  )
}
