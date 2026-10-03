import { useEffect, useMemo, useState } from 'react'
import { Bot, CheckCircle2, Smartphone, Trash2, Upload } from 'lucide-react'
import { supabase } from './supabase'
import { AsyncButton, Confirmar, Info, useToast, type Confirmacion } from './ui'

type Img = { id: string; descripcion: string; url: string; tipo: 'image' | 'video'; activo: boolean; creado_en: string; categoria?: string }
const CATS_BASE = ['General', 'Productos', 'Volantes', 'Promos']

// Galería de imágenes y videos con contexto que el bot puede enviar. Se ordena por categoría y muestra cómo le llega al cliente en WhatsApp.
export default function ImagenesBot() {
  const toast = useToast()
  const [lista, setLista] = useState<Img[]>([])
  const [archivo, setArchivo] = useState<File | null>(null)
  const [desc, setDesc] = useState('')
  const [cat, setCat] = useState('General')
  const [filtro, setFiltro] = useState('todas')
  const [sel, setSel] = useState<string | null>(null)
  const [conf, setConf] = useState<Confirmacion | null>(null)
  const cargar = async () => { const { data } = await supabase.from('bot_imagenes').select('*').order('creado_en', { ascending: false }); setLista(((data ?? []) as Img[]).map((x) => ({ ...x, categoria: x.categoria ?? 'General' }))) }
  useEffect(() => { cargar() }, [])

  const cats = useMemo(() => [...new Set([...CATS_BASE, ...lista.map((i) => i.categoria ?? 'General')])], [lista])
  const vistas = lista.filter((i) => i.activo || i.descripcion).filter((i) => filtro === 'todas' || i.categoria === filtro)
  const actual = lista.find((i) => i.id === sel) ?? vistas[0]

  const subir = async () => {
    if (!archivo || !desc.trim()) { toast('Elige un archivo y escribe su contexto', 'err'); return false }
    const ruta = `biblioteca/${Date.now()}.${archivo.name.split('.').pop()}`
    const { error } = await supabase.storage.from('catalogo').upload(ruta, archivo, { contentType: archivo.type })
    if (error) { toast(error.message, 'err'); return false }
    const url = supabase.storage.from('catalogo').getPublicUrl(ruta).data.publicUrl
    const fila = { descripcion: desc.trim().slice(0, 300), url, tipo: archivo.type.startsWith('video/') ? 'video' : 'image', activo: true }
    let { error: e2 } = await supabase.from('bot_imagenes').insert({ ...fila, categoria: cat.trim() || 'General' })
    if (e2) ({ error: e2 } = await supabase.from('bot_imagenes').insert(fila)) // por si aún falta la migración 0048
    if (e2) { toast(e2.code === '42P01' ? 'Falta correr la migración 0046 en Supabase' : e2.message, 'err'); return false }
    setArchivo(null); setDesc(''); toast('Guardada: el bot ya puede usarla'); cargar()
  }
  const cambiar = async (i: Img, campos: Partial<Img>, aviso?: string) => {
    const { error } = await supabase.from('bot_imagenes').update(campos).eq('id', i.id)
    if (error) { toast(error.message, 'err'); return }
    if (aviso) toast(aviso); cargar()
  }
  const quitar = (i: Img) => setConf({ titulo: 'Quitar del bot', peligro: true, okText: 'Eliminar', texto: <>El bot dejará de usar este archivo.</>,
    onOk: async () => { const { error } = await supabase.from('bot_imagenes').delete().eq('id', i.id); if (error) { toast(error.message, 'err'); return false } toast('Eliminada'); cargar() } })

  const pendientes = lista.filter((i) => !i.activo && !i.descripcion)
  return (
    <>
      <div className="row" style={{ alignItems: 'center', marginBottom: 6 }}><span className="muted" style={{ flex: 1 }}>Material que el bot puede enviar en las conversaciones.</span>
        <Info>Material con contexto para que el bot lo use en las conversaciones (por ejemplo "así se ven las galletas en una caja"). También puedes enviárselo por WhatsApp desde el número del admin con una imagen y decirle qué es.</Info></div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Upload size={18} aria-hidden /> Subir imagen o video</h2>
        <input type="file" aria-label="Archivo" accept="image/*,video/mp4" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
        <label>Contexto (qué es y cuándo usarla)</label>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ej. Así se ven las galletas en la caja de 6" />
        <label>Categoría</label>
        <input list="cats-img" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="Elige o escribe una nueva" />
        <datalist id="cats-img">{cats.map((c) => <option key={c} value={c} />)}</datalist>
        <div className="row"><AsyncButton okText="Guardada" onClick={subir} disabled={!archivo || !desc.trim()}>Guardar para el bot</AsyncButton></div>
      </div>

      <div className="chips" style={{ marginBottom: 10 }} role="group" aria-label="Categorías">
        <button className={`chip ${filtro === 'todas' ? 'on' : ''}`} aria-pressed={filtro === 'todas'} onClick={() => setFiltro('todas')}>Todas ({lista.filter((i) => i.activo || i.descripcion).length})</button>
        {cats.filter((c) => lista.some((i) => i.categoria === c && (i.activo || i.descripcion))).map((c) => <button key={c} className={`chip ${filtro === c ? 'on' : ''}`} aria-pressed={filtro === c} onClick={() => setFiltro(c)}>{c} ({lista.filter((i) => i.categoria === c && (i.activo || i.descripcion)).length})</button>)}
      </div>

      <div className="tarjetas">
        {vistas.map((i) => (
          <div className={`tarjeta img-bot ${i.activo ? 'activa' : 'off'} ${actual?.id === i.id ? 'sel' : ''}`} key={i.id}>
            <button className="img-bot-foto" onClick={() => setSel(i.id)} aria-label={`Ver vista previa: ${i.descripcion}`}>
              {i.tipo === 'video' ? <video className="foto" src={i.url} muted /> : <img className="foto" src={i.url} alt={i.descripcion} loading="lazy" />}
              {i.activo && <span className="img-bot-badge"><Bot size={14} aria-hidden /> Activa en el bot</span>}
              <span className="img-bot-cat">{i.categoria}</span>
            </button>
            <div className="info">
              <textarea style={{ minHeight: 56 }} aria-label="Contexto de la imagen" defaultValue={i.descripcion} onBlur={(e) => { const d = e.target.value.trim().slice(0, 300); if (d !== i.descripcion) void cambiar(i, { descripcion: d, activo: !!d }, 'Contexto actualizado') }} />
              <input list="cats-img" aria-label="Categoría" defaultValue={i.categoria} onBlur={(e) => { const c = e.target.value.trim() || 'General'; if (c !== i.categoria) void cambiar(i, { categoria: c }, 'Categoría actualizada') }} />
              <div className="pie">
                <span className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{i.activo ? <><CheckCircle2 size={14} aria-hidden /> Asignada al bot</> : 'Oculta'}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="sec sm" onClick={() => cambiar(i, { activo: !i.activo }, i.activo ? 'El bot ya no la usa' : 'El bot ya puede usarla')}>{i.activo ? 'Quitar del bot' : 'Usar en el bot'}</button>
                  <button className="sec sm" onClick={() => quitar(i)} aria-label="Eliminar"><Trash2 size={16} aria-hidden /></button>
                </div>
              </div>
            </div>
          </div>))}
      </div>
      {!vistas.length && <p className="muted">Aún no hay material guardado{filtro !== 'todas' ? ' en esta categoría' : ''}.</p>}
      {pendientes.length > 0 && <p className="muted">Hay {pendientes.length} archivo{pendientes.length === 1 ? '' : 's'} recibido{pendientes.length === 1 ? '' : 's'} por WhatsApp sin contexto todavía (el asistente te preguntará qué son).</p>}

      {actual && <div className="card" style={{ marginTop: 12 }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Smartphone size={18} aria-hidden /> Así lo recibe el cliente en WhatsApp</h2>
        <div className="vista-previa-wa">
          <div className="burbuja bot" style={{ maxWidth: 300 }}>
            {actual.tipo === 'video' ? <video className="chat-img" src={actual.url} controls muted /> : <img className="chat-img" src={actual.url} alt="" />}
            <div style={{ whiteSpace: 'pre-wrap' }}>{actual.descripcion || 'Sin texto'}</div>
          </div>
        </div>
      </div>}
      <Confirmar c={conf} onClose={() => setConf(null)} />
    </>
  )
}
