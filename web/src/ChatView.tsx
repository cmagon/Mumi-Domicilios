import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './supabase'
import { AsyncButton, useToast } from './ui'
import PedidosCliente from './PedidosCliente'

type Msg = { id: string; rol: 'user' | 'assistant' | 'admin'; contenido: string; creado_en: string; media_path: string | null }
type Aviso = { id: string; tipo: string; titulo: string; detalle: string | null; pedido_id: string | null; media_path?: string | null }
export const ICONO_AVISO: Record<string, string> = { pago: '💰', pago_revision: '🧾', atencion: '🙋', sin_respuesta: '❓', cambio: '✏️', pedido_grande: '📦', sin_stock: '🍪' }
const RAPIDAS = ['Hola 😊 soy del equipo de Mumi', 'Ya te confirmo, un momento por favor 🙏', 'Gracias por tu pedido 🍪', '¿Me confirmas tu dirección, por favor?']

// Ubicación compartida (pin) y enlaces dentro del mensaje
function Contenido({ texto }: { texto: string }) {
  const loc = texto.match(/compartió su ubicación[\s\S]*?\(lat (-?\d+\.?\d*), lng (-?\d+\.?\d*)\)/)
  if (loc) {
    const aprox = texto.match(/Dirección aproximada detectada: (.*?) \(lat/)?.[1]
    const lugar = texto.match(/Lugar: (.*?)\. Dirección/)?.[1]
    const url = `https://www.google.com/maps?q=${loc[1]},${loc[2]}`
    return <a className="tarjeta-ubicacion" href={url} target="_blank"><b>📍 Ubicación compartida</b>{lugar && <span>{lugar}</span>}{aprox && aprox !== 'no disponible' && <span>{aprox}</span>}<span className="muted">{loc[1]}, {loc[2]} · Abrir en el mapa →</span></a>
  }
  return <>{texto.split(/(https?:\/\/\S+)/g).map((t, i) => (/^https?:/.test(t) ? <a key={i} href={t} target="_blank">{t}</a> : t))}</>
}

// Conversación tipo WhatsApp: historial en vivo, avisos del chat, tomar/devolver al bot y responder como persona.
export default function ChatView({ telefono, nombre, onBack, resumen }: { telefono: string; nombre?: string | null; onBack?: () => void; resumen?: React.ReactNode }) {
  const toast = useToast()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [conv, setConv] = useState<{ humano: boolean; humano_desde: string | null; nombre_wa: string | null } | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [texto, setTexto] = useState('')
  const [verPedidos, setVerPedidos] = useState(false)
  const [nActivos, setNActivos] = useState(0)
  const [foto, setFoto] = useState<{ blob: Blob; url: string } | null>(null)
  const archivo = useRef<HTMLInputElement>(null)
  const [ahora, setAhora] = useState(Date.now())
  const fin = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)

  const marcarLeido = useCallback(() => {
    supabase.from('conversaciones').upsert({ telefono, admin_leido_en: new Date().toISOString() }, { onConflict: 'telefono' }).then(() => {})
  }, [telefono])

  const cargar = useCallback(async () => {
    const [m, c, a] = await Promise.all([
      supabase.from('mensajes').select('id,rol,contenido,creado_en,media_path').eq('telefono', telefono).order('creado_en', { ascending: false }).limit(300),
      supabase.from('conversaciones').select('humano,humano_desde,nombre_wa').eq('telefono', telefono).maybeSingle(),
      supabase.from('notificaciones').select('*').eq('telefono', telefono).eq('leida', false).order('creado_en', { ascending: false }),
    ])
    const lista = ((m.data ?? []) as Msg[]).reverse()
    setMsgs(lista); setConv(c.data as typeof conv); setAvisos((a.data ?? []) as Aviso[])
    const rutas = [...lista.map((x) => x.media_path), ...((a.data ?? []) as Aviso[]).map((x) => x.media_path)].filter(Boolean) as string[]
    if (rutas.length) {
      const { data } = await supabase.storage.from('comprobantes').createSignedUrls(rutas, 3600)
      setUrls(Object.fromEntries((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path as string, d.signedUrl as string])))
    }
  }, [telefono])

  useEffect(() => {
    setMsgs([]); setAvisos([]); setConv(null); setTexto(''); setVerPedidos(false)
    cargar(); marcarLeido()
    const ch = supabase.channel(`chat-${telefono}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes', filter: `telefono=eq.${telefono}` }, () => { cargar(); marcarLeido() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notificaciones', filter: `telefono=eq.${telefono}` }, () => cargar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversaciones', filter: `telefono=eq.${telefono}` }, () => cargar())
      .subscribe()
    const t = setInterval(() => setAhora(Date.now()), 60000)
    return () => { supabase.removeChannel(ch); clearInterval(t) }
  }, [telefono, cargar, marcarLeido])
  useEffect(() => { fin.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])

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
  const enviar = async () => {
    const t = texto.trim()
    if (!t && !foto) return false
    let imagen_path: string | undefined
    if (foto) {
      imagen_path = `salientes/${telefono}/${Date.now()}.jpg`
      const { error: eu } = await supabase.storage.from('comprobantes').upload(imagen_path, foto.blob, { contentType: 'image/jpeg' })
      if (eu) { toast(`No se pudo subir la foto: ${eu.message}`, 'err'); return false }
    }
    const { data, error } = await supabase.functions.invoke('responder-chat', { body: { telefono, texto: t, imagen_path } })
    if (error || !data?.ok) { toast(data?.error ?? error?.message ?? 'No se pudo enviar', 'err'); return false }
    setTexto(''); setFoto(null); if (area.current) area.current.style.height = 'auto'; area.current?.focus(); cargar()
  }
  const tomar = async (v: boolean) => {
    const { error } = await supabase.from('conversaciones').upsert({ telefono, humano: v, humano_desde: v ? new Date().toISOString() : null }, { onConflict: 'telefono' })
    if (error) { toast(error.message, 'err'); return false }
    toast(v ? 'Tomaste la conversación: el bot se calla' : 'El bot vuelve a atender este chat'); cargar()
  }
  const leerAviso = async (id: string) => { await supabase.from('notificaciones').update({ leida: true }).eq('id', id); cargar() }
  const leerTodos = async () => { await supabase.from('notificaciones').update({ leida: true }).in('id', avisos.map((a) => a.id)); cargar() }

  let diaPrev = ''
  return (
    <div className="chatview">
      <div className="chat-cab">
        {onBack && <button className="ghost atras" onClick={onBack} aria-label="Volver">←</button>}
        <div className="avatar">{(nombre ?? conv?.nombre_wa ?? telefono).slice(0, 1).toUpperCase()}</div>
        <div className="chat-quien"><b>{nombre ?? conv?.nombre_wa ?? telefono}</b><span className="muted">{telefono}</span></div>
        <AsyncButton className={humano ? '' : 'sec'} okText="" onClick={() => tomar(!humano)}>{humano ? '🤖 Devolver al bot' : '🙋 Tomar chat'}</AsyncButton>
      </div>
      <div className={`chat-modo ${humano ? 'hum' : ''}`}>
        {humano ? 'Atiendes tú: el bot está en silencio en este chat.' : 'El bot atiende este chat. Si respondes, tomas la conversación.'}
      </div>
      <div className="pestanas"><button className={!verPedidos ? 'on' : ''} onClick={() => setVerPedidos(false)}>💬 Chat</button>
        <button className={verPedidos ? 'on' : ''} onClick={() => setVerPedidos(true)}>📋 Pedidos{nActivos > 0 && <b>{nActivos}</b>}</button></div>
      {resumen}
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
              <div className={`burbuja ${clase} ${nota ? 'nota' : ''}`}>
                {m.rol !== 'user' && <span className="quien">{m.rol === 'admin' ? 'Equipo' : '🤖 Bot'}</span>}
                {m.media_path && urls[m.media_path] && <a href={urls[m.media_path]} target="_blank"><img className="chat-img" src={urls[m.media_path]} alt="imagen del cliente" /></a>}
                <Contenido texto={m.contenido} />
                <span className="hora">{d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}</span>
              </div>
            </div>)
        })}
        <div ref={fin} />
      </div>

      <div className="chat-pie" hidden={verPedidos}>
        {abierta ? (
          <>
            <div className="rapidas">{RAPIDAS.map((r) => <button key={r} className="chip" onClick={() => { setTexto((t) => (t ? t + ' ' : '') + r); area.current?.focus() }}>{r}</button>)}</div>
            {foto && <div className="foto-prev"><img src={foto.url} alt="Vista previa" /><button className="ghost" onClick={() => setFoto(null)} aria-label="Quitar foto">✕</button><span className="muted">El texto se envía como pie de la foto</span></div>}
            <div className="compositor">
              <input ref={archivo} type="file" accept="image/*" hidden onChange={(e) => elegirFoto(e.target.files?.[0])} />
              <button className="sec adjuntar" aria-label="Adjuntar foto" onClick={() => archivo.current?.click()}>📷</button>
              <textarea ref={area} rows={1} placeholder="Escribe un mensaje" value={texto}
                onChange={(e) => { setTexto(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px' }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth >= 900) { e.preventDefault(); void enviar() } }} />
              <AsyncButton className="enviar" okText="" onClick={enviar} disabled={!texto.trim() && !foto}>➤</AsyncButton>
            </div>
            <div className="muted ventana">Puedes responder libremente durante {restante} más (ventana de 24 h de WhatsApp).</div>
          </>
        ) : (
          <div className="ventana-cerrada">🔒 Pasaron más de 24 h desde el último mensaje del cliente. WhatsApp solo permite plantillas aprobadas; podrás responder cuando él escriba de nuevo.</div>
        )}
      </div>
    </div>
  )
}
