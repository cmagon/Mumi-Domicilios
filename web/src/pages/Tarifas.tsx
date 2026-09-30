import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { cop } from '../hooks'
import { AsyncButton, Confirmar, Modal, Switch, useToast, type Confirmacion } from '../ui'

type T = { id: string; nombre: string; valor: number; activo: boolean }

export default function Tarifas() {
  const toast = useToast()
  const [rows, setRows] = useState<T[]>([])
  const [ed, setEd] = useState<{ id: string; nombre: string; valor: string } | null>(null)
  const [err, setErr] = useState<Record<string, boolean>>({})
  const [conf, setConf] = useState<Confirmacion | null>(null)
  const load = async () => { const { data } = await supabase.from('tarifas_domicilio').select('*').order('nombre'); setRows(data ?? []) }
  useEffect(() => { load() }, [])

  const guardar = async () => {
    if (!ed) return false
    const e = { nombre: !ed.nombre.trim(), valor: ed.valor === '' || Number(ed.valor) < 0 }
    setErr(e)
    if (e.nombre || e.valor) { toast('Completa la zona y el valor', 'err'); return false }
    const fila = { nombre: ed.nombre.trim(), valor: Number(ed.valor) }
    const { error } = ed.id ? await supabase.from('tarifas_domicilio').update(fila).eq('id', ed.id) : await supabase.from('tarifas_domicilio').insert(fila)
    if (error) { toast(error.message, 'err'); return false }
    toast(ed.id ? 'Tarifa actualizada' : 'Tarifa agregada'); await load(); setTimeout(() => setEd(null), 450)
  }
  const alternar = async (t: T, activo: boolean) => {
    setRows((l) => l.map((x) => (x.id === t.id ? { ...x, activo } : x)))
    const { error } = await supabase.from('tarifas_domicilio').update({ activo }).eq('id', t.id)
    if (error) { toast(error.message, 'err'); load() }
  }
  const borrar = (t: T) => setConf({ titulo: 'Eliminar tarifa', peligro: true, okText: 'Eliminar', texto: <>¿Eliminar la tarifa <b>{t.nombre}</b> ({cop(t.valor)})?</>,
    onOk: async () => { const { error } = await supabase.from('tarifas_domicilio').delete().eq('id', t.id); if (error) { toast(error.message, 'err'); return false } toast('Tarifa eliminada'); load() } })

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0, flex: '1 1 auto' }}>Tarifas de domicilio</h2>
        <button onClick={() => { setErr({}); setEd({ id: '', nombre: '', valor: '' }) }}>+ Agregar tarifa</button>
      </div>
      <p className="muted">Agrega una tarifa fija (ej. "Tarifa fija") o varias por zona o barrio. El bot usa estas tarifas.</p>
      {rows.map((r) => (
        <div className="card" key={r.id} style={{ opacity: r.activo ? 1 : 0.6 }}>
          <div className="fila-item">
            <div className="crece"><b>{r.nombre}</b><div className="muted">{cop(r.valor)}</div></div>
            <Switch checked={r.activo} onChange={(v) => alternar(r, v)} />
            <button className="sec sm" onClick={() => { setErr({}); setEd({ id: r.id, nombre: r.nombre, valor: String(r.valor) }) }}>Editar</button>
            <button className="sec sm" onClick={() => borrar(r)} aria-label="Eliminar">🗑</button>
          </div>
        </div>))}
      {!rows.length && <p className="muted">Aún no hay tarifas.</p>}

      <Modal abierto={!!ed} titulo={ed?.id ? 'Editar tarifa' : 'Nueva tarifa'} onClose={() => setEd(null)} ancho={400}
        pie={<><button className="sec" onClick={() => setEd(null)}>Cancelar</button><AsyncButton okText="Guardada" onClick={guardar}>Guardar</AsyncButton></>}>
        {ed && <>
          <label>Zona o nombre *</label><input className={err.nombre ? 'invalido' : ''} autoFocus value={ed.nombre} onChange={(e) => setEd({ ...ed, nombre: e.target.value })} />
          <label>Valor (COP) *</label><input className={err.valor ? 'invalido' : ''} type="number" min={0} value={ed.valor} onChange={(e) => setEd({ ...ed, valor: e.target.value })} />
        </>}
      </Modal>
      <Confirmar c={conf} onClose={() => setConf(null)} />
    </>
  )
}
