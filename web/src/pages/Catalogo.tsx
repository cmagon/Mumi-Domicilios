import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { cop } from '../hooks'
import type { Categoria, Producto } from '../types'
import GaleriaMedios from '../GaleriaMedios'
import Combos from '../Combos'
import ImagenesBot from '../ImagenesBot'
import { AsyncButton, Confirmar, Modal, Switch, useToast, type Confirmacion } from '../ui'

const VACIO = { id: '', nombre: '', descripcion: '', detalles: '', precio: '', foto_url: '' as string | null, activo: true, categoria_id: '' }

export default function Catalogo() {
  const toast = useToast()
  const [items, setItems] = useState<Producto[]>([])
  const [ed, setEd] = useState<typeof VACIO | null>(null)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [prev, setPrev] = useState<string | null>(null)
  const [errores, setErrores] = useState<Record<string, boolean>>({})
  const [conf, setConf] = useState<Confirmacion | null>(null)

  const [cats, setCats] = useState<Categoria[]>([])
  const [filtro, setFiltro] = useState<string>('todas')
  const [verCats, setVerCats] = useState(false)
  const [vista, setVista] = useState<'sabores' | 'combos' | 'imagenes'>('sabores')
  const [nuevaCat, setNuevaCat] = useState('')
  const load = async () => {
    const [{ data }, c] = await Promise.all([supabase.from('productos').select('*').order('nombre'), supabase.from('categorias_producto').select('*').order('orden').order('nombre')])
    setItems(data ?? []); setCats((c.data ?? []) as Categoria[]) // si falta la migración 0043, no hay categorías y todo sigue igual
  }
  useEffect(() => { load() }, [])
  const nombreCat = (id?: string | null) => cats.find((c) => c.id === id)?.nombre
  const visibles = items.filter((p) => filtro === 'todas' || (filtro === 'sin' ? !p.categoria_id : p.categoria_id === filtro))
  const crearCat = async () => {
    const n = nuevaCat.trim(); if (!n) return false
    const { error } = await supabase.from('categorias_producto').insert({ nombre: n, orden: cats.length })
    if (error) { toast(error.code === '23505' ? 'Esa categoría ya existe' : error.message, 'err'); return false }
    setNuevaCat(''); await load()
  }
  const renombrarCat = async (c: Categoria, nombre: string) => {
    const n = nombre.trim(); if (!n || n === c.nombre) return
    const { error } = await supabase.from('categorias_producto').update({ nombre: n }).eq('id', c.id)
    if (error) toast(error.code === '23505' ? 'Esa categoría ya existe' : error.message, 'err'); else { toast('Categoría renombrada'); load() }
  }
  const borrarCat = (c: Categoria) => setConf({ titulo: `Eliminar "${c.nombre}"`, peligro: true, okText: 'Eliminar categoría',
    texto: <>Los productos de <b>{c.nombre}</b> no se borran: quedan sin categoría.</>,
    onOk: async () => { const { error } = await supabase.from('categorias_producto').delete().eq('id', c.id); if (error) { toast(error.message, 'err'); return false } if (filtro === c.id) setFiltro('todas'); toast('Categoría eliminada'); load() } })

  const abrir = (p?: Producto) => {
    setErrores({}); setArchivo(null); setPrev(null)
    setEd(p ? { id: p.id, nombre: p.nombre, descripcion: p.descripcion, detalles: p.detalles ?? '', precio: String(p.precio), foto_url: p.foto_url, activo: p.activo, categoria_id: p.categoria_id ?? '' } : { ...VACIO, categoria_id: filtro !== 'todas' && filtro !== 'sin' ? filtro : (cats[0]?.id ?? '') })
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
    const fila = { nombre: ed.nombre.trim(), descripcion: ed.descripcion, detalles: ed.detalles.trim(), precio: Number(ed.precio), foto_url, activo: ed.activo, ...(cats.length ? { categoria_id: ed.categoria_id || null } : {}) }
    const { error } = ed.id ? await supabase.from('productos').update(fila).eq('id', ed.id) : await supabase.from('productos').insert(fila)
    if (error) { toast(error.message, 'err'); return false }
    toast(ed.id ? 'Sabor actualizado' : 'Sabor creado'); await load(); setTimeout(() => setEd(null), 450)
  }
  const alternar = async (p: Producto, activo: boolean) => {
    setItems((l) => l.map((x) => (x.id === p.id ? { ...x, activo } : x)))
    const { error } = await supabase.from('productos').update({ activo }).eq('id', p.id)
    if (error) { toast(error.message, 'err'); load() } else toast(activo ? `${p.nombre} visible para el bot` : `${p.nombre} oculto`)
  }

  // Eliminar un sabor: si ya tiene pedidos asociados la base lo impide; en ese caso se ofrece desactivarlo (queda oculto para el bot)
  const eliminar = (p: Producto) => setConf({
    titulo: `Eliminar "${p.nombre}"`, peligro: true, okText: 'Eliminar sabor',
    texto: <>¿Seguro que quieres eliminar <b>{p.nombre}</b> del catálogo? También se borra su stock registrado. Esta acción no se puede deshacer.</>,
    onOk: async () => {
      const { error } = await supabase.from('productos').delete().eq('id', p.id)
      if (error) {
        if (error.code === '23503') toast(`"${p.nombre}" ya tiene pedidos y no se puede eliminar. Desactívalo con el interruptor para ocultarlo.`, 'err')
        else toast(error.message, 'err')
        return false
      }
      toast(`"${p.nombre}" eliminado`); load()
    },
  })

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0, flex: '1 1 auto' }}>Catálogo</h2>
        {vista === 'sabores' && <><button className="sec" onClick={() => setVerCats(true)}>🗂 Categorías</button>
        <button onClick={() => abrir()}>+ Nuevo sabor</button></>}
      </div>
      <div className="chips" style={{ marginBottom: 12 }}>
        <button className={`chip ${vista === 'sabores' ? 'on' : ''}`} onClick={() => setVista('sabores')}>🧁 Sabores y productos</button>
        <button className={`chip ${vista === 'combos' ? 'on' : ''}`} onClick={() => setVista('combos')}>🎁 Combos y promociones</button>
        <button className={`chip ${vista === 'imagenes' ? 'on' : ''}`} onClick={() => setVista('imagenes')}>🖼 Imágenes del bot</button>
      </div>
      {vista === 'imagenes' ? <ImagenesBot /> : vista === 'combos' ? <Combos productos={items.filter((p) => p.activo)} /> : <>
      {cats.length > 0 && <div className="chips" style={{ marginBottom: 12 }}>
        <button className={`chip ${filtro === 'todas' ? 'on' : ''}`} onClick={() => setFiltro('todas')}>Todas<b>{items.length}</b></button>
        {cats.map((c) => <button key={c.id} className={`chip ${filtro === c.id ? 'on' : ''}`} onClick={() => setFiltro(c.id)}>{c.nombre}<b>{items.filter((p) => p.categoria_id === c.id).length}</b></button>)}
        {items.some((p) => !p.categoria_id) && <button className={`chip ${filtro === 'sin' ? 'on' : ''}`} onClick={() => setFiltro('sin')}>Sin categoría<b>{items.filter((p) => !p.categoria_id).length}</b></button>}
      </div>}
      <div className="tarjetas">
        {visibles.map((p) => (
          <div className={`tarjeta ${p.activo ? '' : 'off'}`} key={p.id}>
            {p.foto_url ? <img className="foto" src={p.foto_url} alt={p.nombre} /> : <div className="foto" />}
            <div className="info">
              <b>{p.nombre}</b>
              {nombreCat(p.categoria_id) && <span className="muted" style={{ fontSize: 12 }}>🗂 {nombreCat(p.categoria_id)}</span>}
              <span className="precio">{cop(p.precio)}</span>
              <span className="desc">{p.descripcion || 'Sin descripción'}</span>
              {p.detalles ? <span className="desc" title={p.detalles}>ℹ️ {p.detalles.length > 70 ? p.detalles.slice(0, 70) + '…' : p.detalles}</span> : <span className="desc" style={{ color: '#b07a00' }}>⚠️ Sin detalles específicos</span>}
              <div className="pie">
                <Switch checked={p.activo} onChange={(v) => alternar(p, v)} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="sec sm" onClick={() => abrir(p)}>Editar</button>
                  <button className="sec sm" onClick={() => eliminar(p)} aria-label={`Eliminar ${p.nombre}`} title="Eliminar">🗑</button>
                </div>
              </div>
            </div>
          </div>))}
        <div className="tarjeta nueva" role="button" tabIndex={0} onClick={() => abrir()} onKeyDown={(e) => e.key === 'Enter' && abrir()}>
          <span className="mas">＋</span>Nuevo sabor
        </div>
      </div>

      </>}
      <Modal abierto={!!ed} titulo={ed?.id ? 'Editar sabor' : 'Nuevo sabor'} onClose={() => setEd(null)}
        pie={<><button className="sec" onClick={() => setEd(null)}>Cancelar</button><AsyncButton okText="Guardado" onClick={guardar}>Guardar</AsyncButton></>}>
        {ed && <>
          <label>Nombre *</label><input className={errores.nombre ? 'invalido' : ''} autoFocus value={ed.nombre} onChange={(e) => setEd({ ...ed, nombre: e.target.value })} />
          {cats.length > 0 && <><label>Categoría</label><select value={ed.categoria_id} onChange={(e) => setEd({ ...ed, categoria_id: e.target.value })}><option value="">Sin categoría</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></>}
          <label>Descripción</label><input value={ed.descripcion} onChange={(e) => setEd({ ...ed, descripcion: e.target.value })} />
          <label>Detalles específicos (ingredientes, alérgenos, tamaño, conservación…)</label>
          <textarea style={{ minHeight: 90 }} placeholder="El bot solo afirma lo que escribas aquí; si falta un dato, dirá que lo confirma con el equipo." value={ed.detalles} onChange={(e) => setEd({ ...ed, detalles: e.target.value })} />
          <label>Precio (COP) *</label><input className={errores.precio ? 'invalido' : ''} type="number" min={0} value={ed.precio} onChange={(e) => setEd({ ...ed, precio: e.target.value })} />
          <label>Fotos y videos</label>
          {ed.id
            ? <GaleriaMedios productoId={ed.id} onPrincipal={(url) => { setEd((x) => x && { ...x, foto_url: url }); load() }} />
            : <>
              {(prev || ed.foto_url) && <img className="thumb" style={{ width: 96, height: 96, marginBottom: 6 }} src={prev ?? ed.foto_url ?? ''} alt="foto" />}
              <input type="file" accept="image/*" onChange={(e) => elegirFoto(e.target.files?.[0])} />
              <p className="muted">Esta será la foto principal. Después de guardar el sabor podrás agregar más fotos y videos.</p></>}
          <Switch checked={ed.activo} onChange={(v) => setEd({ ...ed, activo: v })} label="Visible para el bot y los clientes" />
        </>}
      </Modal>
      <Modal abierto={verCats} titulo="🗂 Categorías del catálogo" onClose={() => setVerCats(false)} ancho={480}
        pie={<button className="sec" onClick={() => setVerCats(false)}>Cerrar</button>}>
        <p className="muted">Crea las categorías que necesites (por ejemplo Galletas, Bebidas, Postres). Cada producto pertenece a una; así, más adelante, el bot podrá sugerir complementos.</p>
        {cats.length === 0 && <p className="muted">Aún no hay categorías. Si ves este mensaje y ya creaste alguna, falta correr la migración 0043 en Supabase.</p>}
        {cats.map((c) => (
          <div className="row" key={c.id} style={{ marginBottom: 6 }}>
            <input defaultValue={c.nombre} style={{ flex: 1 }} onBlur={(e) => renombrarCat(c, e.target.value)} />
            <span className="muted">{items.filter((p) => p.categoria_id === c.id).length}</span>
            <button className="sec sm" onClick={() => borrarCat(c)} aria-label={`Eliminar ${c.nombre}`}>🗑</button>
          </div>))}
        <div className="row" style={{ marginTop: 10 }}>
          <input style={{ flex: 1 }} placeholder="Nueva categoría (ej. Bebidas)" value={nuevaCat} onChange={(e) => setNuevaCat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && crearCat()} />
          <AsyncButton okText="Creada" onClick={crearCat} disabled={!nuevaCat.trim()}>Crear</AsyncButton>
        </div>
      </Modal>
      <Confirmar c={conf} onClose={() => setConf(null)} />
    </>
  )
}
