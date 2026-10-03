import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ImagePlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from './supabase'
import { AsyncButton, Modal, useToast } from './ui'
import PedidosCliente from './PedidosCliente'
import { useConfig } from './hooks'
import QRCode from 'qrcode'
import { useEnVivo } from './enVivo'
import TomarPedido from './TomarPedido'
import Grabadora from './Grabadora'

type Msg = { id: string; rol: 'user' | 'assistant' | 'admin'; contenido: string; creado_en: string; media_path: string | null; wa_id?: string | null; cita?: string | null }
type Aviso = { id: string; tipo: string; titulo: string; detalle: string | null; pedido_id: string | null; media_path?: string | null }
export const ICONO_AVISO: Record<string, string> = { pago: '💰', pago_revision: '🧾', atencion: '🙋', sin_respuesta: '❓', cambio: '✏️', pedido_grande: '📦', sin_stock: '🍪', cancelacion: '🚫' }
const RAPIDAS = ['Hola 😊 soy del equipo de Mumi', 'Ya te confirmo, un momento por favor 🙏', 'Gracias por tu pedido 🍪', '¿Me confirmas tu dirección, por favor?']

function QR({ url }: { url: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 168 }).then(setSrc).catch(() => setSrc('')) }, [url])
  return src ? <a href={url} target="_blank"><img className="ubic-qr" src={src} alt="QR de la ubicación" /></a> : null
}

// Ubicación compartida (pin) y enlaces dentro del mensaje
function Contenido({ texto }: { texto: string }) {
  const loc = texto.match(/compartió su ubicación[\s\S]*?\(lat (-?\d+\.?\d*), lng (-?\d+\.?\d*)\)/)
  if (loc) {
    const aprox = texto.match(/Dirección aproximada detectada: (.*?) \(lat/)?.[1]
    const lugar = texto.match(/Lugar: (.*?)\. Dirección/)?.[1]
    const url = `https://www.google.com/maps?q=${loc[1]},${loc[2]}`
    return (
      <div className="tarjeta-ubicacion">
        <b>📍 Ubicación compartida</b>
        {lugar && <span>{lugar}</span>}{aprox && aprox !== 'no disponible' && <span>{aprox}</span>}
        <div className="ubic-fila">
          <QR url={url} />
          <div className="ubic-link"><a href={url} target="_blank">Abrir en el mapa →</a><a className="muted" href={url} target="_blank">{url.replace('https://', '')}</a>
            <span className="muted">{loc[1]}, {loc[2]}</span></div>
        </div>
      </div>)
  }
  return <>{texto.split(/(https?:\/\/\S+)/g).map((t, i) => (/^https?:/.test(t) ? <a key={i} href={t} target="_blank">{t}</a> : t))}</>
}

// Conversación tipo WhatsApp: historial en vivo, avisos del chat, tomar/devolver al bot y responder como persona.
export default function ChatView({ telefono, nombre, onBack, resumen, equipo = false }: { telefono: string; nombre?: string | null; onBack?: () => void; resumen?: React.ReactNode; equipo?: boolean }) {
  const toast = useToast()
  const { cfg } = useConfig()
  const minHumano = cfg.minutos_humano_sin_responder === '' || cfg.minutos_humano_sin_responder == null ? 5 : Number(cfg.minutos_humano_sin_responder)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [conv, setConv] = useState<{ humano: boolean; humano_desde: string | null; nombre_wa: string | null } | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [texto, setTexto] = useState('')
  const [verPedidos, setVerPedidos] = useState(false)
  const [tomando, setTomando] = useState(false)
  const [nActivos, setNActivos] = useState(0)
  const [enviandoAudio, setEnviandoAudio] = useState<{ id: string; url: string }[]>([])
  const [citando, setCitando] = useState<Msg | null>(null)
  const [biblio, setBiblio] = useState<{ id: string; url: string; tipo: 'image' | 'video'; nombre: string }[] | null>(null)
  // Atajo: enviar al cliente una foto o video ya guardados (biblioteca del bot y fotos del catálogo)
  const abrirBiblio = async () => {
    setBiblio([])
    const [b, p] = await Promise.all([supabase.from('bot_imagenes').select('id,descripcion,url,tipo').eq('activo', true).order('creado_en', { ascending: false }), supabase.from('productos').select('id,nombre,foto_url').eq('activo', true).not('foto_url', 'is', null)])
    setBiblio([...(b.data ?? []).map((x) => ({ id: x.id, url: x.url, tipo: x.tipo as 'image' | 'video', nombre: x.descripcion || 'Imagen del bot' })), ...(p.data ?? []).map((x) => ({ id: x.id, url: x.foto_url as string, tipo: 'image' as const, nombre: x.nombre }))])
  }
  const enviarBiblio = async (m: { url: string; tipo: 'image' | 'video'; nombre: string }) => {
    const { data, error } = await supabase.functions.invoke('responder-chat', { body: { telefono, medio_url: m.url, medio_tipo: m.tipo, texto: m.nombre === 'Imagen del bot' ? '' : m.nombre, responder_a: citando?.wa_id } })
    if (error || !data?.ok) { toast(data?.error ?? error?.message ?? 'No se pudo enviar', 'err'); return false }
    setBiblio(null); setCitando(null); cargar()
  }
  const [foto, setFoto] = useState<{ blob: Blob; url: string } | null>(null)
  const archivo = useRef<HTMLInputElement>(null)
  const [ahora, setAhora] = useState(Date.now())
  const fin = useRef<HTMLDivElement>(null)
  const visto = useRef('')
  const area = useRef<HTMLTextAreaElement>(null)

  const marcarLeido = useCallback(() => {
    supabase.from('conversaciones').upsert({ telefono, admin_leido_en: new Date().toISOString() }, { onConflict: 'telefono' }).then(() => {})
  }, [telefono])

  const cargar = useCallback(async () => {
    const consulta = (cols: string) => supabase.from('mensajes').select(cols).eq('telefono', telefono).order('creado_en', { ascending: false }).limit(300)
    const [m0, c, a] = await Promise.all([
      consulta('id,rol,contenido,creado_en,media_path,wa_id,cita'),
      supabase.from('conversaciones').select('humano,humano_desde,nombre_wa').eq('telefono', telefono).maybeSingle(),
      supabase.from('notificaciones').select('*').eq('telefono', telefono).eq('leida', false).order('creado_en', { ascending: false }),
    ])
    const m = m0.error ? await consulta('id,rol,contenido,creado_en,media_path,wa_id') : m0 // por si la migración 0040 aún no se corrió
    const lista = ((m.data ?? []) as unknown as Msg[]).reverse()
    // Marca como leído solo cuando hay un mensaje nuevo (evita un ciclo de actualizaciones)
    const ult = lista[lista.length - 1]?.id
    if (ult && ult !== visto.current && !document.hidden) {
      visto.current = ult; marcarLeido()
      // Si atiende una persona, recién ahora (al abrir el chat) se marca como leído en WhatsApp
      if ((c.data as { humano?: boolean } | null)?.humano && lista[lista.length - 1].rol === 'user') void supabase.functions.invoke('marcar-leido', { body: { telefono } })
    }
    setMsgs(lista); setConv(c.data as typeof conv); setAvisos((a.data ?? []) as Aviso[])
    const rutas = [...lista.map((x) => x.media_path), ...((a.data ?? []) as Aviso[]).map((x) => x.media_path)].filter(Boolean) as string[]
    if (rutas.length) {
      const { data } = await supabase.storage.from('comprobantes').createSignedUrls(rutas, 3600)
      setUrls(Object.fromEntries((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path as string, d.signedUrl as string])))
    }
  }, [telefono])

  useEffect(() => { visto.current = ''; setMsgs([]); setAvisos([]); setConv(null); setTexto(''); setCitando(null); setVerPedidos(false); cargar() }, [telefono]) // eslint-disable-line
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 60000); return () => clearInterval(t) }, [])
  // Tiempo real: mensajes nuevos, avisos y estado del chat de este cliente, sin recargar
  useEnVivo(`chat-${telefono}`, [{ tabla: 'mensajes', filtro: `telefono=eq.${telefono}` }, { tabla: 'notificaciones', filtro: `telefono=eq.${telefono}` }, { tabla: 'conversaciones', filtro: `telefono=eq.${telefono}` }],
    cargar, 10)
  useEffect(() => { fin.current?.scrollIntoView({ block: 'end' }) }, [msgs.length, enviandoAudio.length])

  // Ventana de 24 h de WhatsApp
  const ultCliente = [...msgs].reverse().find((m) => m.rol === 'user')
  const restanteMs = ultCliente ? 24 * 3600 * 1000 - (ahora - new Date(ultCliente.creado_en).getTime()) : 0
  const abierta = restanteMs > 0
  const restante = `${Math.floor(restanteMs / 3600000)} h ${Math.floor((restanteMs % 3600000) / 60000)} min`
  const humano = !!conv?.humano

  // Reduce la foto (máx. 1600 px, JPEG) para que suba y llegue rápido
  const elegirFoto = async (f: File | undefined) => {
    if (!f) return
    try {
      const bmp = await createImageBitmap(f)
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
      c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
      const blob = await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('x'))), 'image/jpeg', 0.85))
      setFoto({ blob, url: URL.createObjectURL(blob) })
    } catch { toast('No se pudo leer la imagen', 'err') }
    if (archivo.current) archivo.current.value = ''
  }
  // Nota de voz estilo WhatsApp: al terminar de grabar se envía sola, con una burbuja inmediata mientras sube
  const enviarAudio = async (blob: Blob, url: string) => {
    const idTmp = `tmp-${Date.now()}`
    const resp = citando?.wa_id
    setCitando(null)
    setEnviandoAudio((l) => [...l, { id: idTmp, url }])
    try {
      const ruta = `salientes/${telefono}/${Date.now()}.mp3`
      const { error: eu } = await supabase.storage.from('comprobantes').upload(ruta, blob, { contentType: 'audio/mpeg' })
      if (eu) throw new Error(`No se pudo subir el audio: ${eu.message}`)
      const { data, error } = await supabase.functions.invoke('responder-chat', { body: { telefono, audio_path: ruta, responder_a: resp } })
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? 'No se pudo enviar el audio')
      await cargar()
    } catch (e) { toast((e as Error).message, 'err') }
    setEnviandoAudio((l) => l.filter((x) => x.id !== idTmp))
  }
  const enviar = async () => {
    const t = texto.trim()
    if (!t && !foto) return false
    let imagen_path: string | undefined
    if (foto) {
      imagen_path = `salientes/${telefono}/${Date.now()}.jpg`
      const { error: eu } = await supabase.storage.from('comprobantes').upload(imagen_path, foto.blob, { contentType: 'image/jpeg' })
      if (eu) { toast(`No se pudo subir la foto: ${eu.message}`, 'err'); return false }
    }
    const { data, error } = await supabase.functions.invoke('responder-chat', { body: { telefono, texto: t, imagen_path, responder_a: citando?.wa_id } })
    if (error || !data?.ok) { toast(data?.error ?? error?.message ?? 'No se pudo enviar', 'err'); return false }
    setTexto(''); setFoto(null); setCitando(null); if (area.current) area.current.style.height = 'auto'; area.current?.focus(); cargar()
  }
  const tomar = async (v: boolean) => {
    const { error } = await supabase.from('conversaciones').upsert({ telefono, humano: v, humano_desde: v ? new Date().toISOString() : null }, { onConflict: 'telefono' })
    if (error) { toast(error.message, 'err'); return false }
    toast(v ? 'Tomaste la conversación: el bot se calla' : 'El bot vuelve a atender este chat'); cargar()
  }
  const leerAviso = async (id: string) => { await supabase.from('notificaciones').update({ leida: true }).eq('id', id); cargar() }
  const leerTodos = async () => { await supabase.from('notificaciones').update({ leida: true }).in('id', avisos.map((a) => a.id)); cargar() }

  // Deslizar un mensaje hacia la derecha para citarlo (como en WhatsApp)
  const gesto = useRef<{ x: number; y: number; m: Msg } | null>(null)
  const alTocar = (e: React.TouchEvent, m: Msg) => { gesto.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, m } }
  const alMover = (e: React.TouchEvent) => {
    const g = gesto.current; if (!g) return
    const dx = e.touches[0].clientX - g.x, dy = Math.abs(e.touches[0].clientY - g.y)
    if (dy > 30) { gesto.current = null; (e.currentTarget as HTMLElement).style.transform = ''; return }
    if (dx > 0) (e.currentTarget as HTMLElement).style.transform = `translateX(${Math.min(dx, 70)}px)`
  }
  const alSoltar = (e: React.TouchEvent) => {
    const g = gesto.current; gesto.current = null
    const el = e.currentTarget as HTMLElement; const dx = (e.changedTouches[0]?.clientX ?? 0) - (g?.x ?? 0); el.style.transform = ''
    if (g && dx > 60 && g.m.wa_id && abierta) { setCitando(g.m); area.current?.focus(); try { navigator.vibrate?.(15) } catch { /* no soportado */ } }
  }
  let diaPrev = ''
  return (
    <div className="chatview">
      <div className="chat-cab">
        {onBack && <button className="ghost atras" onClick={onBack} aria-label="Volver"><ArrowLeft size={20} aria-hidden /></button>}
        <div className="avatar">{(nombre ?? conv?.nombre_wa ?? telefono).slice(0, 1).toUpperCase()}</div>
        <div className="chat-quien"><b>{nombre ?? conv?.nombre_wa ?? telefono}</b><span className="muted">{telefono}</span></div>
        {equipo ? <span className="mini-badge equipo">👥 Equipo</span> : <AsyncButton className={humano ? '' : 'sec'} okText="" onClick={() => tomar(!humano)}>{humano ? '🤖 Devolver al bot' : '🙋 Tomar chat'}</AsyncButton>}
      </div>
      {equipo && <div className="chat-modo">Conversación con el equipo: el asistente interno atiende estas órdenes por WhatsApp (nunca se trata como cliente).</div>}
      {!equipo && <div className={`chat-modo ${humano ? 'hum' : ''}`}>
        {humano ? `Atiendes tú: el bot está en silencio${minHumano > 0 ? `, pero retoma el chat si tardas más de ${minHumano} min en responder` : ''}.` : 'El bot atiende este chat. Si respondes, tomas la conversación.'}
      </div>}
      {!equipo && <div className="pestanas"><button className={!verPedidos ? 'on' : ''} onClick={() => setVerPedidos(false)}>💬 Chat</button>
        <button className={verPedidos ? 'on' : ''} onClick={() => setVerPedidos(true)}>📋 Pedidos{nActivos > 0 && <b>{nActivos}</b>}</button></div>}
      {!equipo && <div className="burbujas">
        {resumen}
        <button className="burbuja-ia pedido" onClick={() => setTomando(true)} aria-label="Tomar pedido" title="Tomar pedido">🛒</button>
      </div>}
      <TomarPedido telefono={telefono} nombre={nombre ?? conv?.nombre_wa} abierto={tomando} onClose={() => setTomando(false)} />
      {avisos.length > 0 && (
        <div className="avisos-chat">
          {avisos.map((a) => (
            <div className="aviso-item" key={a.id}>
              <span className="aviso-ico">{ICONO_AVISO[a.tipo] ?? '🔔'}</span>
              <div className="aviso-txt"><b>{a.titulo}</b>{a.detalle && <div className="muted">{a.detalle}</div>}
                {a.media_path && urls[a.media_path] && <a href={urls[a.media_path]} target="_blank"><img className="chat-img" style={{ maxHeight: 120 }} src={urls[a.media_path]} alt="Comprobante" /></a>}
                {a.pedido_id && <Link to="/pedidos">Ver pedidos →</Link>}</div>
              <button className="sec sm" onClick={() => leerAviso(a.id)}>Listo</button>
            </div>))}
          {avisos.length > 1 && <button className="ghost" onClick={leerTodos}>Marcar todos como leídos</button>}
        </div>)}

      <div className="pc-panel" hidden={!verPedidos}><PedidosCliente telefono={telefono} onCuenta={setNActivos} /></div>
      <div className="chat" hidden={verPedidos}>
        {!msgs.length && <p className="muted" style={{ textAlign: 'center' }}>No hay mensajes guardados de este cliente.</p>}
        {msgs.map((m) => {
          const d = new Date(m.creado_en)
          const dia = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
          const sep = dia !== diaPrev; diaPrev = dia
          const nota = m.rol !== 'user' && /^\[.*\]$/.test(m.contenido.trim())
          const clase = m.rol === 'user' ? 'cli' : m.rol === 'admin' ? 'adm' : 'bot'
          return (
            <div key={m.id}>
              {sep && <div className="chat-dia">{dia}</div>}
              <div className={`fila-msg ${m.rol === 'user' ? 'izq' : 'der'}`} onTouchStart={(e) => alTocar(e, m)} onTouchMove={alMover} onTouchEnd={alSoltar} onDoubleClick={() => { if (m.wa_id && abierta) { setCitando(m); area.current?.focus() } }}>
              <div className={`burbuja ${clase} ${nota ? 'nota' : ''}`}>
                {m.rol !== 'user' && <span className="quien">{m.rol === 'admin' ? 'Equipo' : '🤖 Bot'}</span>}
                {m.cita && <div className="cita-msg">{m.cita}</div>}
                {m.wa_id && abierta && !equipo && <button className="responder-btn" aria-label="Responder a este mensaje" title="Responder" onClick={() => { setCitando(m); area.current?.focus() }}>↩</button>}
                {m.media_path && urls[m.media_path] && (/\.(mp3|ogg|m4a|webm|aac)$/i.test(m.media_path)
                  ? <audio className="chat-audio" controls src={urls[m.media_path]} />
                  : <a href={urls[m.media_path]} target="_blank"><img className="chat-img" src={urls[m.media_path]} alt="imagen del cliente" /></a>)}
                <Contenido texto={m.media_path && /\.(mp3|ogg|m4a|webm|aac)$/i.test(m.media_path) ? m.contenido.replace(/^🎤 Nota de voz del equipo:?\s*/, '') || 'Nota de voz' : m.contenido} />
                <span className="hora">{d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}</span>
              </div>
              </div>
            </div>)
        })}
        {enviandoAudio.map((a) => (
          <div key={a.id} className="fila-msg der"><div className="burbuja adm"><span className="quien">Equipo</span><audio className="chat-audio" controls src={a.url} /><span className="hora">Enviando…</span></div></div>))}
        <div ref={fin} />
      </div>

      <Modal abierto={biblio !== null} titulo="Enviar una foto al cliente" onClose={() => setBiblio(null)} ancho={520}
        pie={<button className="sec" onClick={() => setBiblio(null)}>Cerrar</button>}>
        {biblio && !biblio.length && <p className="muted">Cargando… (si no aparece nada, aún no hay fotos en el catálogo ni en Imágenes del bot)</p>}
        <div className="biblio-grid">
          {(biblio ?? []).map((m) => (
            <button key={`${m.tipo}-${m.id}`} className="biblio-item" onClick={() => enviarBiblio(m)} aria-label={`Enviar ${m.nombre}`}>
              {m.tipo === 'video' ? <video src={m.url} muted /> : <img src={m.url} alt="" loading="lazy" />}<span>{m.nombre}</span>
            </button>))}
        </div>
      </Modal>
      {!equipo && <div className="chat-pie" hidden={verPedidos}>
        {abierta ? (
          <>
            <div className="rapidas">{RAPIDAS.map((r) => <button key={r} className="chip" onClick={() => { setTexto((t) => (t ? t + ' ' : '') + r); area.current?.focus() }}>{r}</button>)}</div>
            {citando && <div className="citando"><div><b>{citando.rol === 'user' ? 'Cliente' : citando.rol === 'admin' ? 'Equipo' : 'Bot'}</b><span>{citando.contenido.replace(/^\[.*?\]\s*/, '').slice(0, 140) || '📎 Archivo'}</span></div><button className="ghost" onClick={() => setCitando(null)} aria-label="Quitar cita">✕</button></div>}
            {foto && <div className="foto-prev"><img src={foto.url} alt="Vista previa" /><button className="ghost" onClick={() => setFoto(null)} aria-label="Quitar foto">✕</button><span className="muted">El texto se envía como pie de la foto</span></div>}
            <div className="compositor">
              <input ref={archivo} type="file" accept="image/*" hidden onChange={(e) => elegirFoto(e.target.files?.[0])} />
              <button className="sec adjuntar" aria-label="Adjuntar foto" onClick={() => archivo.current?.click()}>📷</button>
              <button className="sec adjuntar" aria-label="Enviar foto del catálogo o del bot" title="Fotos del catálogo y del bot" onClick={abrirBiblio}><ImagePlus size={18} aria-hidden /></button>
              <Grabadora onListo={enviarAudio} onError={(m) => toast(m, 'err')} />
              <textarea ref={area} rows={1} aria-label="Escribe un mensaje" placeholder="Escribe un mensaje" value={texto}
                onChange={(e) => { setTexto(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px' }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth >= 900) { e.preventDefault(); void enviar() } }} />
              <AsyncButton className="enviar" okText="" onClick={enviar} disabled={!texto.trim() && !foto}>➤</AsyncButton>
            </div>
            <div className="muted ventana">Puedes responder libremente durante {restante} más (ventana de 24 h de WhatsApp).</div>
          </>
        ) : (
          <div className="ventana-cerrada">🔒 Pasaron más de 24 h desde el último mensaje del cliente. WhatsApp solo permite plantillas aprobadas; podrás responder cuando él escriba de nuevo.</div>
        )}
      </div>}
    </div>
  )
}
