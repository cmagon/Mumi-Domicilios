import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { cop } from './hooks'
import type { Producto } from './types'
import { AsyncButton, Confirmar, Modal, Switch, useToast, type Confirmacion, Info } from './ui'

type Item = { producto_id: string; cantidad: number }
type Combo = { id: string; nombre: string; descripcion: string; precio: number; imagen_url: string | null; desde: string | null; hasta: string | null; activo: boolean; combo_items: (Item & { productos?: { nombre: string; precio: number } | null })[] }
const VACIO = { id: '', nombre: '', descripcion: '', precio: '', imagen_url: '' as string | null, desde: '', hasta: '', activo: true, items: [] as Item[] }
const hoyCO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })

// Combos y promociones: paquetes de productos a un precio especial (con vigencia opcional). El bot los ofrece cuando están vigentes.
export default function Combos({ productos }: { productos: Producto[] }) {
  const toast = useToast()
  const [lista, setLista] = useState<Combo[]>([])
  const [ed, setEd] = useState<typeof VACIO | null>(null)
  const [foto, setFoto] = useState<File | null>(null)
  const [prev, setPrev] = useState<string | null>(null)
  const [conf, setConf] = useState<Confirmacion | null>(null)

  const cargar = async () => {
    const { data } = await supabase.from('combos').select('*,combo_items(producto_id,cantidad,productos(nombre,precio))').order('creado_en', { ascending: false })
    setLista((data ?? []) as Combo[])
  }
  useEffect(() => { cargar() }, [])

  const normal = (items: Item[]) => items.reduce((t, i) => t + i.cantidad * (productos.find((p) => p.id === i.producto_id)?.precio ?? 0), 0)
  const abrir = (c?: Combo) => {
    setFoto(null); setPrev(null)
    setEd(c ? { id: c.id, nombre: c.nombre, descripcion: c.descripcion, precio: String(c.precio), imagen_url: c.imagen_url, desde: c.desde ?? '', hasta: c.hasta ?? '', activo: c.activo, items: c.combo_items.map((i) => ({ producto_id: i.producto_id, cantidad: i.cantidad })) } : { ...VACIO, items: [{ producto_id: productos[0]?.id ?? '', cantidad: 1 }] })
  }
  const vigente = (c: Combo) => c.activo && (!c.desde || c.desde <= hoyCO()) && (!c.hasta || c.hasta >= hoyCO())

  const guardar = async () => {
    if (!ed) return false
    const items = ed.items.filter((i) => i.producto_id && i.cantidad >= 1)
    if (!ed.nombre.trim() || ed.precio === '' || Number(ed.precio) < 0) { toast('Escribe el nombre y el precio', 'err'); return false }
    if (!items.length) { toast('Agrega al menos una galleta al combo', 'err'); return false }
    if (ed.desde && ed.hasta && ed.hasta < ed.desde) { toast('La fecha final es anterior a la inicial', 'err'); return false }
    let imagen_url = ed.imagen_url
    if (foto) {
      const ruta = `combos/${Date.now()}.${foto.name.split('.').pop()}`
      const { error } = await supabase.storage.from('catalogo').upload(ruta, foto, { contentType: foto.type })
      if (error) { toast(error.message, 'err'); return false }
      imagen_url = supabase.storage.from('catalogo').getPublicUrl(ruta).data.publicUrl
    }
    const fila = { nombre: ed.nombre.trim(), descripcion: ed.descripcion.trim(), precio: Math.round(Number(ed.precio)), imagen_url: imagen_url || null, desde: ed.desde || null, hasta: ed.hasta || null, activo: ed.activo }
    let id = ed.id
    if (id) { const { error } = await supabase.from('combos').update(fila).eq('id', id); if (error) { toast(error.message, 'err'); return false }; await supabase.from('combo_items').delete().eq('combo_id', id) }
    else { const { data, error } = await supabase.from('combos').insert(fila).select('id').single(); if (error || !data) { toast(error?.code === '42P01' ? 'Falta correr la migración 0045 en Supabase' : (error?.message ?? 'Error'), 'err'); return false }; id = data.id }
    const { error: ei } = await supabase.from('combo_items').insert(items.map((i) => ({ combo_id: id, producto_id: i.producto_id, cantidad: Math.round(i.cantidad) })))
    if (ei) { toast(ei.message, 'err'); return false }
    toast('Combo guardado'); await cargar(); setTimeout(() => setEd(null), 400)
  }
  const alternar = async (c: Combo, activo: boolean) => { await supabase.from('combos').update({ activo }).eq('id', c.id); toast(activo ? 'Combo activo: el bot lo ofrece si está vigente' : 'Combo oculto'); cargar() }
  const eliminar = (c: Combo) => setConf({ titulo: `Eliminar "${c.nombre}"`, peligro: true, okText: 'Eliminar combo', texto: <>Se borra el combo. Los pedidos ya hechos con este combo no se tocan.</>,
    onOk: async () => { const { error } = await supabase.from('combos').delete().eq('id', c.id); if (error) { toast(error.message, 'err'); return false } toast('Combo eliminado'); cargar() } })

  return (
    <>
      <Info bloque>Crea combos o promociones con varias galletas a un precio especial. Mientras estén <b>vigentes</b>, el bot los ofrece cuando preguntan por ofertas y también en el primer mensaje de la conversación, y puede venderlos.</Info>
      <div className="tarjetas">
        {lista.map((c) => (
          <div className={`tarjeta ${c.activo ? '' : 'off'}`} key={c.id}>
            {c.imagen_url ? <img className="foto" src={c.imagen_url} alt={c.nombre} /> : <div className="foto" />}
            <div className="info">
              <b>{c.nombre}</b>
              <span className="precio">{cop(c.precio)} {normal(c.combo_items) > c.precio && <span className="muted" style={{ textDecoration: 'line-through', fontWeight: 400 }}>{cop(normal(c.combo_items))}</span>}</span>
              <span className="desc">{c.combo_items.map((i) => `${i.cantidad} ${i.productos?.nombre ?? '?'}`).join(' + ')}</span>
              <span className="muted" style={{ fontSize: 12 }}>{vigente(c) ? '🟢 Vigente' : c.activo ? '⏳ Fuera de fechas' : '⚪ Oculto'}{c.desde || c.hasta ? ` · ${c.desde ?? '…'} → ${c.hasta ?? '…'}` : ''}</span>
              <div className="pie">
                <Switch checked={c.activo} onChange={(v) => alternar(c, v)} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="sec sm" onClick={() => abrir(c)}>Editar</button>
                  <button className="sec sm" onClick={() => eliminar(c)} aria-label="Eliminar">🗑</button>
                </div>
              </div>
            </div>
          </div>))}
        <div className="tarjeta nueva" role="button" tabIndex={0} onClick={() => abrir()} onKeyDown={(e) => e.key === 'Enter' && abrir()}><span className="mas">＋</span>Nuevo combo</div>
      </div>

      <Modal abierto={!!ed} titulo={ed?.id ? 'Editar combo' : 'Nuevo combo o promoción'} onClose={() => setEd(null)}
        pie={<><button className="sec" onClick={() => setEd(null)}>Cancelar</button><AsyncButton okText="Guardado" onClick={guardar}>Guardar</AsyncButton></>}>
        {ed && <>
          <label>Nombre *</label><input autoFocus value={ed.nombre} onChange={(e) => setEd({ ...ed, nombre: e.target.value })} placeholder="Ej. Combo 4 galletas" />
          <label>Descripción (opcional)</label><input value={ed.descripcion} onChange={(e) => setEd({ ...ed, descripcion: e.target.value })} placeholder="Ej. Ideal para compartir" />
          <label>¿Qué incluye? *</label>
          {ed.items.map((it, idx) => (
            <div className="row" key={idx} style={{ marginBottom: 6 }}>
              <input type="number" min={1} style={{ width: 70 }} value={it.cantidad} onChange={(e) => setEd({ ...ed, items: ed.items.map((x, k) => (k === idx ? { ...x, cantidad: Number(e.target.value) } : x)) })} />
              <select style={{ flex: 1 }} value={it.producto_id} onChange={(e) => setEd({ ...ed, items: ed.items.map((x, k) => (k === idx ? { ...x, producto_id: e.target.value } : x)) })}>
                {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({cop(p.precio)})</option>)}
              </select>
              <button className="sec sm" onClick={() => setEd({ ...ed, items: ed.items.filter((_, k) => k !== idx) })} aria-label="Quitar">✕</button>
            </div>))}
          <button className="sec sm" onClick={() => setEd({ ...ed, items: [...ed.items, { producto_id: productos[0]?.id ?? '', cantidad: 1 }] })}>+ Agregar galleta</button>
          <label>Precio del combo (COP) *</label><input type="number" min={0} value={ed.precio} onChange={(e) => setEd({ ...ed, precio: e.target.value })} />
          {normal(ed.items) > 0 && <p className="muted">Precio normal de lo que incluye: {cop(normal(ed.items))}{ed.precio !== '' && Number(ed.precio) < normal(ed.items) ? ` · ahorro ${cop(normal(ed.items) - Number(ed.precio))}` : ''}</p>}
          <div className="grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div><label>Vigente desde (opcional)</label><input type="date" value={ed.desde} onChange={(e) => setEd({ ...ed, desde: e.target.value })} /></div>
            <div><label>Vigente hasta (opcional)</label><input type="date" value={ed.hasta} onChange={(e) => setEd({ ...ed, hasta: e.target.value })} /></div>
          </div>
          <label>Imagen (opcional)</label>
          {(prev || ed.imagen_url) && <img className="thumb" style={{ width: 96, height: 96, objectFit: 'cover', marginBottom: 6 }} src={prev ?? ed.imagen_url ?? ''} alt="imagen" />}
          <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFoto(f); setPrev(URL.createObjectURL(f)) } }} />
          <Switch checked={ed.activo} onChange={(v) => setEd({ ...ed, activo: v })} label="Activo (el bot lo ofrece mientras esté vigente)" />
        </>}
      </Modal>
      <Confirmar c={conf} onClose={() => setConf(null)} />
    </>
  )
}
