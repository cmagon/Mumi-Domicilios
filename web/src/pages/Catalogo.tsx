import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import type { Producto } from '../types'

export default function Catalogo() {
  const [items, setItems] = useState<Producto[]>([])
  const load = async () => { const { data } = await supabase.from('productos').select('*').order('nombre'); setItems(data ?? []) }
  useEffect(() => { load() }, [])
  const upd = (id: string, patch: Partial<Producto>) => setItems(items.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const guardar = async (p: Producto) => {
    const { id, ...rest } = p
    await supabase.from('productos').update(rest).eq('id', id); load()
  }
  const nuevo = async () => { await supabase.from('productos').insert({ nombre: 'Nuevo sabor', precio: 0 }); load() }
  const foto = async (p: Producto, f: File) => {
    const path = `${p.id}-${Date.now()}.${f.name.split('.').pop()}`
    const { error } = await supabase.storage.from('catalogo').upload(path, f, { contentType: f.type })
    if (error) return alert(error.message)
    const url = supabase.storage.from('catalogo').getPublicUrl(path).data.publicUrl
    upd(p.id, { foto_url: url }); await supabase.from('productos').update({ foto_url: url }).eq('id', p.id)
  }
  return (
    <>
      <button onClick={nuevo}>+ Nuevo sabor</button>
      {items.map((p) => (
        <div className="card" key={p.id}>
          {p.foto_url && <img className="thumb" src={p.foto_url} alt={p.nombre} />}
          <label>Nombre</label><input value={p.nombre} onChange={(e) => upd(p.id, { nombre: e.target.value })} />
          <label>Descripción</label><input value={p.descripcion} onChange={(e) => upd(p.id, { descripcion: e.target.value })} />
          <label>Precio (COP)</label><input type="number" value={p.precio} onChange={(e) => upd(p.id, { precio: +e.target.value })} />
          <label>Foto (alta calidad)</label><input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && foto(p, e.target.files[0])} />
          <label><input type="checkbox" style={{ width: 'auto' }} checked={p.activo} onChange={(e) => upd(p.id, { activo: e.target.checked })} /> Activo</label>
          <button onClick={() => guardar(p)}>Guardar</button>
        </div>))}
    </>
  )
}
