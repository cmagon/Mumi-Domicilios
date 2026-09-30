import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { cop } from '../hooks'
import type { Producto } from '../types'
import { AsyncButton, Modal, Switch, useToast } from '../ui'

const VACIO = { id: '', nombre: '', descripcion: '', precio: '', foto_url: '' as string | null, activo: true }

export default function Catalogo() {
  const toast = useToast()
  const [items, setItems] = useState<Producto[]>([])
  const [ed, setEd] = useState<typeof VACIO | null>(null)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [prev, setPrev] = useState<string | null>(null)
  const [errores, setErrores] = useState<Record<string, boolean>>({})

  const load = async () => { const { data } = await supabase.from('productos').select('*').order('nombre'); setItems(data ?? []) }
  useEffect(() => { load() }, [])

  const abrir = (p?: Producto) => {
    setErrores({}); setArchivo(null); setPrev(null)
    setEd(p ? { id: p.id, nombre: p.nombre, descripcion: p.descripcion, precio: String(p.precio), foto_url: p.foto_url, activo: p.activo } : { ...VACIO })
  }
  const elegirFoto = (f: File | undefined) => { if (!f) return; setArchivo(f); setPrev(URL.createObjectURL(f)) }

  const guardar = async () => {
    if (!ed) return false
    const err = { nombre: !ed.nombre.trim(), precio: ed.precio === '' || Number(ed.precio) < 0 }
    setErrores(err)
    if (err.nombre || err.precio) { toast('Completa el nombre y el precio', 'err'); return false }
    let foto_url = ed.foto_url
    if (archivo) {
      const path = `${Date.now()}.${archivo.name.split('.').pop()}`
      const { error } = await supabase.storage.from('catalogo').upload(path, archivo, { contentType: archivo.type })
      if (error) { toast(error.message, 'err'); return false }
      foto_url = supabase.storage.from('catalogo').getPublicUrl(path).data.publicUrl
    }
    const fila = { nombre: ed.nombre.trim(), descripcion: ed.descripcion, precio: Number(ed.precio), foto_url, activo: ed.activo }
    const { error } = ed.id ? await supabase.from('productos').update(fila).eq('id', ed.id) : await supabase.from('productos').insert(fila)
    if (error) { toast(error.message, 'err'); return false }
    toast(ed.id ? 'Sabor actualizado' : 'Sabor creado'); await load(); setTimeout(() => setEd(null), 450)
  }
  const alternar = async (p: Producto, activo: boolean) => {
    setItems((l) => l.map((x) => (x.id === p.id ? { ...x, activo } : x)))
    const { error } = await supabase.from('productos').update({ activo }).eq('id', p.id)
    if (error) { toast(error.message, 'err'); load() } else toast(activo ? `${p.nombre} visible para el bot` : `${p.nombre} oculto`)
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0, flex: '1 1 auto' }}>Catálogo</h2>
        <button onClick={() => abrir()}>+ Nuevo sabor</button>
      </div>
      {items.map((p) => (
        <div className="card" key={p.id} style={{ opacity: p.activo ? 1 : 0.6 }}>
          <div className="fila-item">
            {p.foto_url ? <img className="thumb" src={p.foto_url} alt={p.nombre} /> : <div className="foto-vacia" />}
            <div className="crece"><b>{p.nombre}</b><div className="muted">{cop(p.precio)}{p.descripcion ? ` · ${p.descripcion}` : ''}</div></div>
            <Switch checked={p.activo} onChange={(v) => alternar(p, v)} />
            <button className="sec sm" onClick={() => abrir(p)}>Editar</button>
          </div>
        </div>))}
      {!items.length && <p className="muted">Aún no hay sabores. Crea el primero.</p>}

      <Modal abierto={!!ed} titulo={ed?.id ? 'Editar sabor' : 'Nuevo sabor'} onClose={() => setEd(null)}
        pie={<><button className="sec" onClick={() => setEd(null)}>Cancelar</button><AsyncButton okText="Guardado" onClick={guardar}>Guardar</AsyncButton></>}>
        {ed && <>
          <label>Nombre *</label><input className={errores.nombre ? 'invalido' : ''} autoFocus value={ed.nombre} onChange={(e) => setEd({ ...ed, nombre: e.target.value })} />
          <label>Descripción</label><input value={ed.descripcion} onChange={(e) => setEd({ ...ed, descripcion: e.target.value })} />
          <label>Precio (COP) *</label><input className={errores.precio ? 'invalido' : ''} type="number" min={0} value={ed.precio} onChange={(e) => setEd({ ...ed, precio: e.target.value })} />
          <label>Foto (alta calidad)</label>
          {(prev || ed.foto_url) && <img className="thumb" style={{ width: 96, height: 96, marginBottom: 6 }} src={prev ?? ed.foto_url ?? ''} alt="foto" />}
          <input type="file" accept="image/*" onChange={(e) => elegirFoto(e.target.files?.[0])} />
          <Switch checked={ed.activo} onChange={(v) => setEd({ ...ed, activo: v })} label="Visible para el bot y los clientes" />
        </>}
      </Modal>
    </>
  )
}
