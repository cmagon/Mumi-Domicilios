import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { cop } from '../hooks'

type T = { id: string; nombre: string; valor: number; activo: boolean }
export default function Tarifas() {
  const [rows, setRows] = useState<T[]>([])
  const [nombre, setNombre] = useState('')
  const [valor, setValor] = useState('')
  const load = async () => { const { data } = await supabase.from('tarifas_domicilio').select('*').order('nombre'); setRows(data ?? []) }
  useEffect(() => { load() }, [])
  const add = async () => {
    if (!nombre) return
    await supabase.from('tarifas_domicilio').insert({ nombre, valor: +valor || 0 }); setNombre(''); setValor(''); load()
  }
  const del = async (id: string) => { await supabase.from('tarifas_domicilio').delete().eq('id', id); load() }
  return (
    <div className="card"><h2>Tarifas de domicilio</h2>
      <p className="muted">Agrega una tarifa fija (ej. "Tarifa fija") o varias por zona/barrio.</p>
      <table><tbody>{rows.map((r) => (
        <tr key={r.id}><td>{r.nombre}</td><td>{cop(r.valor)}</td><td><button className="sec sm" onClick={() => del(r.id)}>Eliminar</button></td></tr>))}</tbody></table>
      <div className="row"><input placeholder="Zona o nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <input type="number" placeholder="Valor" value={valor} onChange={(e) => setValor(e.target.value)} />
        <button onClick={add}>Agregar</button></div>
    </div>
  )
}
