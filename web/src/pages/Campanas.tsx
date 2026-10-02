import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { useConfig } from '../hooks'
import { numerosEquipo } from '../equipo'
import { AsyncButton, Confirmar, Modal, useToast, type Confirmacion } from '../ui'

type Campana = { id: string; nombre: string; texto: string; imagen_url: string | null; boton1: string | null; boton2: string | null; estado: 'borrador' | 'enviada'; creado_en: string; enviada_en: string | null }
type Envio = { campana_id: string; telefono: string; estado: string; boton_tocado: number | null }
type Dest = { telefono: string; nombre: string; ultimo: number }
const VACIA = { id: '', nombre: '', texto: '', imagen_url: '' as string | null, boton1: '', boton2: '' }

// Reduce la imagen (máx. 1280 px, JPEG) para que WhatsApp la acepte y cargue rápido
async function comprimir(f: File): Promise<Blob> {
  const bmp = await createImageBitmap(f)
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('imagen'))), 'image/jpeg', 0.85))
}

export default function Campanas() {
  const toast = useToast()
  const { cfg } = useConfig()
  const [lista, setLista] = useState<Campana[]>([])
  const [envios, setEnvios] = useState<Envio[]>([])
  const [ed, setEd] = useState<typeof VACIA | null>(null)
  const [foto, setFoto] = useState<Blob | null>(null)
  const [prev, setPrev] = useState<string | null>(null)
  const [conf, setConf] = useState<Confirmacion | null>(null)
  const [envio, setEnvio] = useState<Campana | null>(null)

  const cargar = async () => {
    const [c, e] = await Promise.all([supabase.from('campanas').select('*').order('creado_en', { ascending: false }), supabase.from('campana_envios').select('campana_id,telefono,estado,boton_tocado')])
    setLista((c.data ?? []) as Campana[]); setEnvios((e.data ?? []) as Envio[])
  }
  useEffect(() => { cargar() }, [])

  const abrir = (c?: Campana) => { setFoto(null); setPrev(null); setEd(c ? { id: c.id, nombre: c.nombre, texto: c.texto, imagen_url: c.imagen_url, boton1: c.boton1 ?? '', boton2: c.boton2 ?? '' } : { ...VACIA }) }
  const elegirFoto = async (f: File | undefined) => {
    if (!f) return
    try { const b = await comprimir(f); setFoto(b); setPrev(URL.createObjectURL(b)) } catch { toast('No se pudo leer la imagen', 'err') }
  }
  const guardar = async () => {
    if (!ed) return false
    if (!ed.nombre.trim() || !ed.texto.trim()) { toast('Escribe el nombre y el texto', 'err'); return false }
    if (!ed.boton1.trim() && ed.boton2.trim()) { toast('Usa primero el botón 1', 'err'); return false }
    let imagen_url = ed.imagen_url
    if (foto) {
      const ruta = `campanas/${Date.now()}.jpg`
      const { error } = await supabase.storage.from('catalogo').upload(ruta, foto, { contentType: 'image/jpeg' })
      if (error) { toast(error.message, 'err'); return false }
      imagen_url = supabase.storage.from('catalogo').getPublicUrl(ruta).data.publicUrl
    }
    const fila = { nombre: ed.nombre.trim(), texto: ed.texto.trim().slice(0, 1024), imagen_url: imagen_url || null, boton1: ed.boton1.trim().slice(0, 20) || null, boton2: ed.boton2.trim().slice(0, 20) || null }
    const { error } = ed.id ? await supabase.from('campanas').update(fila).eq('id', ed.id) : await supabase.from('campanas').insert(fila)
    if (error) { toast(error.code === '42P01' ? 'Falta correr la migración 0044 en Supabase' : error.message, 'err'); return false }
    toast('Campaña guardada'); await cargar(); setTimeout(() => setEd(null), 400)
  }
  const eliminar = (c: Campana) => setConf({ titulo: `Eliminar "${c.nombre}"`, peligro: true, okText: 'Eliminar', texto: <>Se borra la campaña y su historial de envíos. Los mensajes ya enviados no se pueden retirar de WhatsApp.</>,
    onOk: async () => { const { error } = await supabase.from('campanas').delete().eq('id', c.id); if (error) { toast(error.message, 'err'); return false } toast('Campaña eliminada'); cargar() } })

  const cuenta = (id: string) => { const e = envios.filter((x) => x.campana_id === id); return { ok: e.filter((x) => x.estado === 'enviado').length, toques: e.filter((x) => x.boton_tocado).length } }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0, flex: '1 1 auto' }}>Campañas</h2>
        <button onClick={() => abrir()}>+ Nueva campaña</button>
      </div>
      <p className="muted">Crea un mensaje con imagen, texto y hasta 2 botones y envíalo a los clientes que escribieron en las últimas 24 h (la ventana de WhatsApp). Cuando alguien toca un botón, el bot continúa la conversación.</p>
      <div className="tarjetas">
        {lista.map((c) => { const n = cuenta(c.id); return (
          <div className="tarjeta" key={c.id}>
            {c.imagen_url ? <img className="foto" src={c.imagen_url} alt={c.nombre} /> : <div className="foto" />}
            <div className="info">
              <b>{c.nombre}</b>
              <span className="desc">{c.texto.length > 90 ? c.texto.slice(0, 90) + '…' : c.texto}</span>
              <span className="muted" style={{ fontSize: 12 }}>{c.estado === 'enviada' ? `✅ Enviada a ${n.ok}${n.toques ? ` · ${n.toques} toque${n.toques === 1 ? '' : 's'} de botón` : ''}` : '📝 Borrador'}</span>
              <div className="pie"><span />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="sec sm" onClick={() => abrir(c)}>Editar</button>
                  <button className="sm" onClick={() => setEnvio(c)}>{c.estado === 'enviada' ? 'Enviar a más' : 'Enviar'}</button>
                  <button className="sec sm" onClick={() => eliminar(c)} aria-label="Eliminar">🗑</button>
                </div></div>
            </div>
          </div>) })}
        <div className="tarjeta nueva" role="button" tabIndex={0} onClick={() => abrir()} onKeyDown={(e) => e.key === 'Enter' && abrir()}><span className="mas">＋</span>Nueva campaña</div>
      </div>

      <Modal abierto={!!ed} titulo={ed?.id ? 'Editar campaña' : 'Nueva campaña'} onClose={() => setEd(null)}
        pie={<><button className="sec" onClick={() => setEd(null)}>Cancelar</button><AsyncButton okText="Guardada" onClick={guardar}>Guardar</AsyncButton></>}>
        {ed && <>
          <label>Nombre interno *</label><input autoFocus value={ed.nombre} onChange={(e) => setEd({ ...ed, nombre: e.target.value })} placeholder="Ej. Promo del viernes" />
          <label>Imagen (opcional)</label>
          {(prev || ed.imagen_url) && <img className="thumb" style={{ width: 120, height: 120, objectFit: 'cover', marginBottom: 6 }} src={prev ?? ed.imagen_url ?? ''} alt="imagen" />}
          <input type="file" accept="image/*" onChange={(e) => elegirFoto(e.target.files?.[0])} />
          <label>Texto * ({ed.texto.length}/1024)</label>
          <textarea style={{ minHeight: 110 }} maxLength={1024} value={ed.texto} onChange={(e) => setEd({ ...ed, texto: e.target.value })} placeholder="Escribe el mensaje que verá el cliente" />
          <div className="grid2">
            <div><label>Botón 1 (máx. 20 letras)</label><input maxLength={20} value={ed.boton1} onChange={(e) => setEd({ ...ed, boton1: e.target.value })} placeholder="Ej. Quiero pedir" /></div>
            <div><label>Botón 2 (opcional)</label><input maxLength={20} value={ed.boton2} onChange={(e) => setEd({ ...ed, boton2: e.target.value })} placeholder="Ej. Ver sabores" /></div>
          </div>
          <label>Así se verá</label>
          <div className="vista-previa-wa">
            <div className="burbuja bot" style={{ maxWidth: 280 }}>
              {(prev || ed.imagen_url) && <img className="chat-img" src={prev ?? ed.imagen_url ?? ''} alt="" />}
              <div style={{ whiteSpace: 'pre-wrap' }}>{ed.texto || 'Tu texto…'}</div>
            </div>
            {[ed.boton1, ed.boton2].filter((b) => b.trim()).map((b, i) => <div className="boton-wa" key={i}>{b}</div>)}
          </div>
        </>}
      </Modal>

      {envio && <EnviarCampana c={envio} equipo={numerosEquipo(cfg)} yaEnviados={envios.filter((e) => e.campana_id === envio.id && e.estado === 'enviado').map((e) => e.telefono)} onClose={() => { setEnvio(null); cargar() }} />}
      <Confirmar c={conf} onClose={() => setConf(null)} />
    </>
  )
}

function EnviarCampana({ c, equipo, yaEnviados, onClose }: { c: Campana; equipo: string[]; yaEnviados: string[]; onClose: () => void }) {
  const toast = useToast()
  const [dest, setDest] = useState<Dest[] | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')

  useEffect(() => {
    (async () => {
      const desde = new Date(Date.now() - 23.5 * 3600 * 1000).toISOString()
      const { data: m } = await supabase.from('mensajes').select('telefono,creado_en').eq('rol', 'user').gte('creado_en', desde).order('creado_en', { ascending: false }).limit(3000)
      const ult = new Map<string, number>()
      for (const x of m ?? []) if (!ult.has(x.telefono)) ult.set(x.telefono, new Date(x.creado_en).getTime())
      const tels = [...ult.keys()].filter((t) => !equipo.includes(t))
      const { data: cv } = tels.length ? await supabase.from('conversaciones').select('telefono,nombre_wa').in('telefono', tels) : { data: [] }
      const { data: pd } = tels.length ? await supabase.from('pedidos').select('chat_telefono,cliente_nombre').in('chat_telefono', tels).order('creado_en', { ascending: false }) : { data: [] }
      const nombre = (t: string) => (pd ?? []).find((p) => p.chat_telefono === t)?.cliente_nombre ?? (cv ?? []).find((x) => x.telefono === t)?.nombre_wa ?? t
      const lista = tels.map((t) => ({ telefono: t, nombre: nombre(t), ultimo: ult.get(t)! }))
      setDest(lista); setSel(new Set(lista.filter((d) => !yaEnviados.includes(d.telefono)).map((d) => d.telefono)))
    })()
  }, []) // eslint-disable-line

  const visibles = useMemo(() => (dest ?? []).filter((d) => !q.trim() || `${d.nombre} ${d.telefono}`.toLowerCase().includes(q.trim().toLowerCase())), [dest, q])
  const alternar = (t: string) => setSel((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n })
  const quedan = (d: Dest) => { const ms = 24 * 3600 * 1000 - (Date.now() - d.ultimo); return `${Math.max(0, Math.floor(ms / 3600000))} h ${Math.max(0, Math.floor((ms % 3600000) / 60000))} min` }
  const enviar = async () => {
    if (!sel.size) { toast('Elige al menos un cliente', 'err'); return false }
    const { data, error } = await supabase.functions.invoke('enviar-campana', { body: { campana_id: c.id, telefonos: [...sel] } })
    if (error || !data?.ok) { toast(data?.error ?? error?.message ?? 'No se pudo enviar', 'err'); return false }
    toast(`Enviada a ${data.enviados}${data.fallidos ? ` · ${data.fallidos} fallaron` : ''}${data.omitidos ? ` · ${data.omitidos} omitidos (ventana cerrada o ya la tenían)` : ''}`, data.fallidos ? 'err' : 'info')
    setTimeout(onClose, 500)
  }

  return (
    <Modal abierto titulo={`Enviar "${c.nombre}"`} onClose={onClose} ancho={520}
      pie={<><span className="muted" style={{ marginRight: 'auto' }}>{sel.size} seleccionado{sel.size === 1 ? '' : 's'}</span><button className="sec" onClick={onClose}>Cancelar</button><AsyncButton okText="Enviada" disabled={!sel.size} onClick={enviar}>Enviar a {sel.size}</AsyncButton></>}>
      <p className="muted">Solo aparecen clientes con la ventana de 24 h abierta (escribieron hace menos de 24 h). El equipo nunca recibe campañas.</p>
      {dest === null ? <p className="muted">Cargando…</p> : !dest.length ? <p className="muted">No hay clientes con la ventana abierta ahora mismo.</p> : <>
        <div className="row" style={{ marginBottom: 6 }}>
          <input style={{ flex: 1 }} placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="sec sm" onClick={() => setSel(new Set(dest.filter((d) => !yaEnviados.includes(d.telefono)).map((d) => d.telefono)))}>Todos</button>
          <button className="sec sm" onClick={() => setSel(new Set())}>Ninguno</button>
        </div>
        <div style={{ maxHeight: 320, overflow: 'auto' }}>
          {visibles.map((d) => { const ya = yaEnviados.includes(d.telefono); return (
            <label key={d.telefono} className="row" style={{ gap: 8, padding: '6px 2px', opacity: ya ? .5 : 1, cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={sel.has(d.telefono)} disabled={ya} onChange={() => alternar(d.telefono)} />
              <span style={{ flex: 1 }}><b>{d.nombre}</b> <span className="muted">{d.telefono}</span></span>
              <span className="muted" style={{ fontSize: 12 }}>{ya ? 'ya la recibió' : `quedan ${quedan(d)}`}</span>
            </label>) })}
        </div></>}
    </Modal>
  )
}
