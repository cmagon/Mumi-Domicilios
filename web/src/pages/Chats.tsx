import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { useEnVivo } from '../enVivo'
import ChatView, { ICONO_AVISO } from '../ChatView'
import { AsyncButton, Modal, useToast } from '../ui'

type B = {
  telefono: string; nombre_wa: string | null; humano: boolean; ultimo_contenido: string | null; ultimo_rol: string | null; ultimo_en: string | null
  no_leidos: number; avisos: number; tipos_avisos: string[] | null
  ult_vendida: boolean | null; ult_escalada: boolean | null; ult_sin_stock: boolean | null; ult_resultado: string | null; ult_motivo: string | null
  ult_etapa: string | null; ult_resumen: string | null; ult_fin: string | null; ult_pedido: number | null
}
type S = { telefono: string; inicio: string; fin: string; vendida: boolean; pidio_sin_stock: boolean; escalada: boolean; resultado: string | null; motivo: string | null; etapa: string | null }
type Filtro = 'todos' | 'avisos' | 'sin_leer' | 'hum' | 'venta' | 'trunc'
const MOTIVO: Record<string, string> = { precio: 'Precio', sin_stock: 'Sin stock', fecha_entrega: 'Fecha u hora de entrega', domicilio_tarifa: 'Domicilio / tarifa',
  metodo_pago: 'Método de pago', no_respondio: 'Dejó de responder', duda_sin_resolver: 'Duda sin resolver', error_bot: 'Error del bot',
  solo_informacion: 'Solo pedía información', pidio_persona: 'Pidió hablar con una persona', otro: 'Otro' }
const ETAPA: Record<string, string> = { saludo: 'Saludo', catalogo: 'Catálogo', eleccion: 'Elección de sabores', entrega: 'Entrega', datos: 'Datos del cliente', pago: 'Pago' }

const estadoDe = (b: B): 'venta' | 'trunc' | 'hum' | 'curso' | null => {
  if (!b.ult_fin) return null
  if (b.ult_vendida) return 'venta'
  if (Date.now() - new Date(b.ult_fin).getTime() < 2 * 3600 * 1000) return 'curso'
  if (b.ult_resultado === 'atencion_humana' || b.ult_escalada) return 'hum'
  return 'trunc'
}
const hora = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso), h = new Date()
  if (d.toDateString() === h.toDateString()) return d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })
  if (h.getTime() - d.getTime() < 6 * 86400000) return d.toLocaleDateString('es-CO', { weekday: 'short' })
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

export default function Chats() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [lista, setLista] = useState<B[]>([])
  const [ses, setSes] = useState<S[]>([])
  const [generales, setGenerales] = useState(0)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [q, setQ] = useState('')
  const [analisis, setAnalisis] = useState(false)
  const sel = params.get('t')
  const abrir = (t: string | null) => setParams(t ? { t } : {}, { replace: false })

  const cargar = useCallback(async () => {
    const [b, s, g] = await Promise.all([
      supabase.from('chats_bandeja').select('*').order('ultimo_en', { ascending: false, nullsFirst: false }).limit(300),
      supabase.from('chat_sesiones').select('telefono,inicio,fin,vendida,pidio_sin_stock,escalada,resultado,motivo,etapa').order('inicio', { ascending: false }).limit(500),
      supabase.from('notificaciones').select('id', { count: 'exact', head: true }).eq('leida', false).is('telefono', null),
    ])
    setLista((b.data ?? []) as B[]); setSes((s.data ?? []) as S[]); setGenerales(g.count ?? 0)
  }, [])
  useEnVivo('bandeja', [{ tabla: 'mensajes' }, { tabla: 'notificaciones' }, { tabla: 'conversaciones' }], cargar, 10)

  // En móvil, el chat abierto ocupa toda la pantalla (se esconde el encabezado)
  useEffect(() => {
    document.body.classList.toggle('chat-abierto', !!sel)
    // Altura realmente visible (descontando el teclado) para que el campo de escribir quede pegado encima de él
    const vv = window.visualViewport
    const ajustar = () => { document.documentElement.style.setProperty('--vv-h', `${vv?.height ?? window.innerHeight}px`); window.scrollTo(0, 0) }
    if (sel) { ajustar(); vv?.addEventListener('resize', ajustar); vv?.addEventListener('scroll', ajustar) }
    return () => { document.body.classList.remove('chat-abierto'); vv?.removeEventListener('resize', ajustar); vv?.removeEventListener('scroll', ajustar); document.documentElement.style.removeProperty('--vv-h') }
  }, [sel])

  const atencion = (b: B) => b.avisos > 0 || b.no_leidos > 0
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase()
    return lista.filter((b) => {
      if (t && !`${b.nombre_wa ?? ''} ${b.telefono}`.toLowerCase().includes(t)) return false
      const e = estadoDe(b)
      switch (filtro) {
        case 'avisos': return b.avisos > 0
        case 'sin_leer': return b.no_leidos > 0
        case 'hum': return b.humano || e === 'hum'
        case 'venta': return e === 'venta'
        case 'trunc': return e === 'trunc'
        default: return true
      }
    }).sort((a, b) => Number(atencion(b)) - Number(atencion(a)))
  }, [lista, q, filtro])
  const cuentaFiltro = (f: Filtro) => lista.filter((b) => { const e = estadoDe(b)
    return f === 'avisos' ? b.avisos > 0 : f === 'sin_leer' ? b.no_leidos > 0 : f === 'hum' ? b.humano || e === 'hum' : f === 'venta' ? e === 'venta' : f === 'trunc' ? e === 'trunc' : true }).length
  const actual = lista.find((b) => b.telefono === sel)

  // KPIs pequeños
  const cerradas = ses.length || 1
  const nVenta = ses.filter((s) => s.vendida).length
  const nTrunc = ses.filter((s) => !s.vendida && Date.now() - new Date(s.fin).getTime() > 2 * 3600 * 1000).length

  return (
    <div className={`chats-app ${sel ? 'abierto' : ''}`}>
      <div className="col-lista">
        <div className="lista-cab">
          <div className="fila">
            <input style={{ flex: 1 }} placeholder="Buscar chat" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="sec sm" onClick={() => setAnalisis(true)}>📊</button>
          </div>
          <div className="mini-kpi">
            <span><b>{lista.length}</b> chats</span><span><b>{Math.round((nVenta / cerradas) * 100)}%</b> venta</span>
            <span><b>{Math.round((nTrunc / cerradas) * 100)}%</b> truncadas</span><span><b>{cuentaFiltro('hum')}</b> con persona</span>
          </div>
          <div className="chips">
            {([['todos', 'Todos'], ['avisos', '🔔 Avisos'], ['sin_leer', 'Sin leer'], ['hum', '🙋 Persona'], ['venta', '✅ Ventas'], ['trunc', '⚠️ Truncadas']] as [Filtro, string][]).map(([f, l]) => (
              <button key={f} className={`chip ${filtro === f ? 'on' : ''}`} onClick={() => setFiltro(f)}>{l}{f !== 'todos' && cuentaFiltro(f) ? <b>{cuentaFiltro(f)}</b> : null}</button>))}
          </div>
        </div>
        <div className="lista-chats">
          {generales > 0 && <div className="chat-item atencion" onClick={() => abrir('__generales')}><div className="avatar">🔔</div>
            <div className="centro"><div className="linea1"><b>Avisos generales</b></div><div className="previa">Avisos sin un cliente asociado</div></div><span className="no-leidos">{generales}</span></div>}
          {visibles.map((b) => {
            const e = estadoDe(b)
            return (
              <div key={b.telefono} className={`chat-item ${atencion(b) ? 'atencion' : ''} ${sel === b.telefono ? 'activo' : ''}`} onClick={() => abrir(b.telefono)}>
                <div className="avatar">{(b.nombre_wa ?? b.telefono).slice(0, 1).toUpperCase()}</div>
                <div className="centro">
                  <div className="linea1"><b>{b.nombre_wa ?? b.telefono}</b><span className="hora-ult">{hora(b.ultimo_en)}</span></div>
                  <div className="linea2">
                    <span className="previa">{b.ultimo_rol === 'admin' ? 'Tú: ' : b.ultimo_rol === 'assistant' ? '🤖 ' : ''}{b.ultimo_contenido?.replace(/\s+/g, ' ') ?? ''}</span>
                    {b.no_leidos > 0 && <span className="no-leidos">{b.no_leidos}</span>}
                  </div>
                  <div className="etiquetas">
                    {b.avisos > 0 && <span className="mini-badge aviso">{(b.tipos_avisos ?? []).slice(0, 3).map((t) => ICONO_AVISO[t] ?? '🔔').join('')} {b.avisos} aviso{b.avisos > 1 ? 's' : ''}</span>}
                    {b.humano && <span className="mini-badge hum">🙋 Tú atiendes</span>}
                    {e === 'venta' && <span className="mini-badge venta">✅ Pedido #{b.ult_pedido}</span>}
                    {e === 'trunc' && <span className="mini-badge trunc">⚠️ {MOTIVO[b.ult_motivo ?? ''] ?? (b.ult_sin_stock ? 'Sin stock' : 'Truncada')}</span>}
                  </div>
                </div>
              </div>)
          })}
          {!visibles.length && <p className="muted" style={{ textAlign: 'center', padding: 24 }}>No hay chats en esta vista.</p>}
        </div>
      </div>

      <div className="col-chat">
        {sel === '__generales' ? <Generales onBack={() => abrir(null)} onCambio={cargar} />
          : sel ? <ChatView key={sel} telefono={sel} nombre={actual?.nombre_wa} onBack={() => abrir(null)}
              resumen={<BannerAnalisis key={sel} b={actual} s={ses.find((x) => x.telefono === sel)} recargar={cargar} toast={toast} />} />
          : <div className="chat-vacio"><div style={{ fontSize: 48 }}>💬</div><p>Elige un chat para responder</p></div>}
      </div>

      <Analisis abierto={analisis} onClose={() => setAnalisis(false)} ses={ses} recargar={cargar} toast={toast} />
    </div>
  )
}

// Resumen de la IA para el chat. El análisis es por conversación; si el chat siguió después, queda "desactualizado" y se puede repetir.
function BannerAnalisis({ b, s, recargar, toast }: { b?: B; s?: S; recargar: () => void; toast: ReturnType<typeof useToast> }) {
  const [abierto, setAbierto] = useState(false)
  const [an, setAn] = useState<{ analizado_en: string; sugerencia: string | null } | null>(null)
  const cargar = useCallback(() => {
    if (!s) return
    supabase.from('chats_analisis').select('analizado_en,sugerencia').eq('telefono', s.telefono).eq('sesion_inicio', s.inicio).maybeSingle().then(({ data }) => setAn(data))
  }, [s?.telefono, s?.inicio]) // eslint-disable-line
  useEffect(() => { cargar() }, [cargar, b?.ult_resumen])
  if (!b || !s) return null
  const desact = an && new Date(s.fin).getTime() > new Date(an.analizado_en).getTime() + 60000
  const analizar = async () => {
    const { data, error } = await supabase.functions.invoke('analizar-chats', { body: { telefono: s.telefono, inicio: s.inicio } })
    if (error || !data?.ok) { toast(data?.error ?? error?.message ?? 'No se pudo analizar', 'err'); return false }
    if (!data.analizadas) toast('No se pudo analizar (¿ya hubo una venta o faltan mensajes del cliente?)', 'info')
    cargar(); recargar()
  }
  const icono = b.ult_vendida ? '✅' : desact ? '⚠️' : '🧠'
  return (
    <div className="analisis-burbuja">
      <button className={`burbuja-ia ${abierto ? 'on' : ''}`} onClick={() => setAbierto(!abierto)} aria-label="Análisis de IA">{abierto ? '✕' : icono}</button>
      {abierto && (
        <div className="analisis-resumen">
          {b.ult_vendida ? <>✅ Venta cerrada · pedido #{b.ult_pedido}</> : <>
            {b.ult_resumen ? <>🧠 {b.ult_resumen}{b.ult_etapa ? ` (se cayó en: ${ETAPA[b.ult_etapa] ?? b.ult_etapa})` : ''}
              {an?.sugerencia && <div className="muted">💡 {an.sugerencia}</div>}
              <div className="muted">{desact ? '⚠️ Desactualizado: el chat siguió después del análisis.' : an ? `Analizado ${hora(an.analizado_en)}.` : ''}</div></>
              : <span className="muted">Aún sin análisis. Se hace solo unas 3 horas después de que termina la conversación.</span>}
            <div style={{ marginTop: 4 }}><AsyncButton className="sec sm" okText="Analizado" onClick={analizar}>{b.ult_resumen ? '🔄 Volver a analizar' : '🧠 Analizar ahora'}</AsyncButton></div></>}
        </div>)}
    </div>
  )
}

function Generales({ onBack, onCambio }: { onBack: () => void; onCambio: () => void }) {
  const [av, setAv] = useState<{ id: string; tipo: string; titulo: string; detalle: string | null; creado_en: string }[]>([])
  const c = useCallback(() => { supabase.from('notificaciones').select('id,tipo,titulo,detalle,creado_en').eq('leida', false).is('telefono', null).order('creado_en', { ascending: false }).then(({ data }) => setAv(data ?? [])) }, [])
  useEffect(() => { c() }, [c])
  const leer = async (id: string) => { await supabase.from('notificaciones').update({ leida: true }).eq('id', id); c(); onCambio() }
  return (
    <div className="chatview"><div className="chat-cab"><button className="ghost atras" onClick={onBack}>←</button><b>Avisos generales</b></div>
      <div className="avisos-chat" style={{ maxHeight: 'none', flex: 1 }}>
        {av.map((a) => <div className="aviso-item" key={a.id}><span className="aviso-ico">{ICONO_AVISO[a.tipo] ?? '🔔'}</span>
          <div className="aviso-txt"><b>{a.titulo}</b><div className="muted">{a.detalle}</div></div><button className="sec sm" onClick={() => leer(a.id)}>Listo</button></div>)}
        {!av.length && <p className="muted">Sin avisos pendientes.</p>}
      </div></div>
  )
}

function Analisis({ abierto, onClose, ses, recargar, toast }: { abierto: boolean; onClose: () => void; ses: S[]; recargar: () => void; toast: ReturnType<typeof useToast> }) {
  const trunc = ses.filter((s) => !s.vendida && Date.now() - new Date(s.fin).getTime() > 2 * 3600 * 1000)
  const motivos = useMemo(() => { const m: Record<string, number> = {}; trunc.forEach((s) => { const k = s.motivo ?? (s.pidio_sin_stock ? 'sin_stock' : null); if (k) m[k] = (m[k] ?? 0) + 1 }); return Object.entries(m).sort((a, b) => b[1] - a[1]) }, [ses]) // eslint-disable-line
  const etapas = useMemo(() => { const m: Record<string, number> = {}; trunc.forEach((s) => { if (s.etapa) m[s.etapa] = (m[s.etapa] ?? 0) + 1 }); return Object.entries(m).sort((a, b) => b[1] - a[1]) }, [ses]) // eslint-disable-line
  const sinAnalizar = trunc.filter((s) => !s.resultado).length
  const analizar = async () => {
    const { data, error } = await supabase.functions.invoke('analizar-chats', { body: { limite: 10 } })
    if (error || !data?.ok) { toast(data?.error ?? error?.message ?? 'No se pudo analizar', 'err'); return false }
    toast(`${data.analizadas} analizada(s)`, 'info'); recargar()
  }
  const Barras = ({ datos, mapa }: { datos: [string, number][]; mapa: Record<string, string> }) => {
    const max = Math.max(1, ...datos.map((d) => d[1]))
    return <div className="barras">{datos.map(([k, n]) => (<div className="barra-fila" key={k}><span>{mapa[k] ?? k}</span><div className="pista"><div className="relleno" style={{ width: `${(n / max) * 100}%` }} /></div><b>{n}</b></div>))}</div>
  }
  return (
    <Modal abierto={abierto} titulo="Análisis de conversaciones" onClose={onClose}>
      <p className="muted">{ses.length} conversaciones · {ses.filter((s) => s.vendida).length} ventas ({trunc.length} truncadas)</p>
      <h3 style={{ fontSize: 14 }}>¿Por qué se truncan?</h3>
      {motivos.length ? <Barras datos={motivos} mapa={MOTIVO} /> : <p className="muted">Aún no hay análisis.</p>}
      {etapas.length > 0 && <><h3 style={{ fontSize: 14 }}>¿En qué paso se caen?</h3><Barras datos={etapas} mapa={ETAPA} /></>}
      <div style={{ marginTop: 10 }}><AsyncButton className="sec" okText="Analizadas" onClick={analizar}>Analizar con IA{sinAnalizar ? ` (${sinAnalizar})` : ''}</AsyncButton></div>
    </Modal>
  )
}
