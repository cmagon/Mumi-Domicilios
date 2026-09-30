import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { cop } from '../hooks'
import ChatModal from '../ChatModal'
import { AsyncButton, useToast } from '../ui'

type S = {
  telefono: string; inicio: string; fin: string; mensajes: number; mensajes_cliente: number; nombre_wa: string | null; humano: boolean
  pedido_id: string | null; pedido_numero: number | null; pedido_total: number | null; vendida: boolean; pidio_sin_stock: boolean; escalada: boolean
  resultado: string | null; motivo: string | null; etapa: string | null; resumen: string | null; sugerencia: string | null
}
type Estado = 'venta' | 'trunc' | 'hum' | 'curso'
const MOTIVO: Record<string, string> = { precio: 'Precio', sin_stock: 'Sin stock', fecha_entrega: 'Fecha u hora de entrega', domicilio_tarifa: 'Domicilio / tarifa',
  metodo_pago: 'Método de pago', no_respondio: 'Dejó de responder', duda_sin_resolver: 'Duda sin resolver', error_bot: 'Error del bot',
  solo_informacion: 'Solo pedía información', pidio_persona: 'Pidió hablar con una persona', otro: 'Otro' }
const ETAPA: Record<string, string> = { saludo: 'Saludo', catalogo: 'Catálogo', eleccion: 'Elección de sabores', entrega: 'Entrega', datos: 'Datos del cliente', pago: 'Pago' }
const ETIQUETA: Record<Estado, string> = { venta: '✅ Venta', trunc: '⚠️ Truncada', hum: '🙋 Atención humana', curso: '💬 En curso' }

function estadoDe(s: S): Estado {
  if (s.vendida) return 'venta'
  if (Date.now() - new Date(s.fin).getTime() < 2 * 3600 * 1000) return 'curso'
  if (s.resultado === 'atencion_humana' || s.escalada) return 'hum'
  return 'trunc'
}
const motivoDe = (s: S) => s.motivo ?? (s.pidio_sin_stock ? 'sin_stock' : null)

export default function Chats() {
  const toast = useToast()
  const [ses, setSes] = useState<S[]>([])
  const [filtro, setFiltro] = useState<'todas' | Estado>('todas')
  const [q, setQ] = useState('')
  const [abierta, setAbierta] = useState<S | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('chat_sesiones').select('*').order('inicio', { ascending: false }).limit(400)
    setSes((data ?? []) as S[])
  }, [])
  useEffect(() => {
    load()
    const ch = supabase.channel('chats-vivo').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes' }, () => load()).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const conEstado = useMemo(() => ses.map((s) => ({ s, e: estadoDe(s) })), [ses])
  const cuenta = (e: Estado) => conEstado.filter((x) => x.e === e).length
  const cerradas = conEstado.filter((x) => x.e !== 'curso').length || 1

  const motivos = useMemo(() => {
    const m: Record<string, number> = {}
    conEstado.filter((x) => x.e === 'trunc' || x.e === 'hum').forEach(({ s }) => { const k = motivoDe(s); if (k) m[k] = (m[k] ?? 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [conEstado])
  const etapas = useMemo(() => {
    const m: Record<string, number> = {}
    conEstado.filter((x) => x.e === 'trunc').forEach(({ s }) => { if (s.etapa) m[s.etapa] = (m[s.etapa] ?? 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [conEstado])
  const sinAnalizar = conEstado.filter((x) => x.e === 'trunc' && !x.s.resultado).length

  const lista = conEstado.filter(({ s, e }) => (filtro === 'todas' || e === filtro) &&
    (!q.trim() || `${s.nombre_wa ?? ''} ${s.telefono}`.toLowerCase().includes(q.trim().toLowerCase())))

  const analizar = async (foco?: S) => {
    const { data, error } = await supabase.functions.invoke('analizar-chats', { body: foco ? { telefono: foco.telefono, inicio: foco.inicio } : { limite: 10 } })
    if (error || !data?.ok) { toast(data?.error ?? error?.message ?? 'No se pudo analizar', 'err'); return false }
    toast(data.analizadas ? `${data.analizadas} conversación${data.analizadas === 1 ? '' : 'es'} analizada${data.analizadas === 1 ? '' : 's'}` : 'No había conversaciones por analizar', 'info')
    await load()
    if (foco) setAbierta((a) => a)
  }
  const Barras = ({ datos, mapa }: { datos: [string, number][]; mapa: Record<string, string> }) => {
    const max = Math.max(1, ...datos.map((d) => d[1]))
    return <div className="barras">{datos.map(([k, n]) => (
      <div className="barra-fila" key={k}><span>{mapa[k] ?? k}</span><div className="pista"><div className="relleno" style={{ width: `${(n / max) * 100}%` }} /></div><b>{n}</b></div>))}</div>
  }
  const abiertaActual = abierta ? ses.find((x) => x.telefono === abierta.telefono && x.inicio === abierta.inicio) ?? abierta : null

  return (
    <>
      <div className="kpi">
        <div className="card"><div className="muted">Conversaciones</div><div className="big">{ses.length}</div></div>
        <div className="card"><div className="muted">Llegan a venta</div><div className="big">{Math.round((cuenta('venta') / cerradas) * 100)}%</div><div className="muted">{cuenta('venta')} ventas</div></div>
        <div className="card"><div className="muted">Se truncan</div><div className="big">{Math.round((cuenta('trunc') / cerradas) * 100)}%</div><div className="muted">{cuenta('trunc')} sin venta</div></div>
        <div className="card"><div className="muted">Pasan a una persona</div><div className="big">{cuenta('hum')}</div></div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, flex: '1 1 auto' }}>¿Por qué se truncan?</h2>
          <AsyncButton className="sec" okText="Analizadas" onClick={() => analizar()}>Analizar con IA{sinAnalizar ? ` (${sinAnalizar})` : ''}</AsyncButton>
        </div>
        {motivos.length ? <Barras datos={motivos} mapa={MOTIVO} /> : <p className="muted">Aún no hay análisis. Las conversaciones cerradas sin venta se analizan solas, o pulsa el botón.</p>}
        {etapas.length > 0 && <><h3 style={{ margin: '14px 0 0', fontSize: 14 }}>¿En qué paso se caen?</h3><Barras datos={etapas} mapa={ETAPA} /></>}
      </div>

      <div className="card">
        <div className="chips">
          {([['todas', 'Todas', ses.length], ['venta', 'Con venta', cuenta('venta')], ['trunc', 'Truncadas', cuenta('trunc')], ['hum', 'Atención humana', cuenta('hum')], ['curso', 'En curso', cuenta('curso')]] as [string, string, number][]).map(([f, l, n]) => (
            <button key={f} className={`chip ${filtro === f ? 'on' : ''}`} onClick={() => setFiltro(f as typeof filtro)}>{l}<b>{n}</b></button>))}
        </div>
        <input style={{ marginTop: 8 }} placeholder="Buscar por nombre o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {lista.map(({ s, e }) => (
        <div className="card" key={s.telefono + s.inicio} style={{ cursor: 'pointer' }} onClick={() => setAbierta(s)}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b style={{ flex: '1 1 auto' }}>{s.nombre_wa ?? s.telefono} <span className="muted">{s.nombre_wa ? s.telefono : ''}</span></b>
            <span className={`badge ${e}`}>{ETIQUETA[e]}</span>
          </div>
          <p className="muted" style={{ margin: '4px 0' }}>
            {new Date(s.inicio).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })} · {s.mensajes} mensajes ({s.mensajes_cliente} del cliente)
            {s.vendida && <> · pedido #{s.pedido_numero} · {cop(s.pedido_total ?? 0)}</>}
          </p>
          {e !== 'venta' && motivoDe(s) && <p style={{ margin: '2px 0' }}><span className="badge">{MOTIVO[motivoDe(s)!] ?? motivoDe(s)}</span>{s.etapa && <span className="badge"> en: {ETAPA[s.etapa] ?? s.etapa}</span>}</p>}
          {s.resumen && <p style={{ margin: '4px 0 0' }}>{s.resumen}</p>}
        </div>))}
      {!lista.length && <p className="muted" style={{ textAlign: 'center', padding: 24 }}>No hay conversaciones en esta vista.</p>}

      <ChatModal telefono={abiertaActual?.telefono ?? null} titulo={abiertaActual ? `Chat · ${abiertaActual.nombre_wa ?? abiertaActual.telefono}` : ''}
        desde={abiertaActual?.inicio} hasta={abiertaActual?.fin} onClose={() => setAbierta(null)}
        extra={abiertaActual && (
          <div style={{ marginBottom: 10 }}>
            <span className={`badge ${estadoDe(abiertaActual)}`}>{ETIQUETA[estadoDe(abiertaActual)]}</span>{' '}
            {motivoDe(abiertaActual) && <span className="badge">{MOTIVO[motivoDe(abiertaActual)!]}</span>}
            {abiertaActual.resumen && <p style={{ margin: '8px 0 2px' }}><b>Resumen:</b> {abiertaActual.resumen}</p>}
            {abiertaActual.sugerencia && <p style={{ margin: '2px 0' }}><b>Sugerencia:</b> {abiertaActual.sugerencia}</p>}
            {!abiertaActual.vendida && <div style={{ marginTop: 6 }}><AsyncButton className="sec sm" okText="Analizada" onClick={() => analizar(abiertaActual)}>{abiertaActual.resultado ? 'Volver a analizar' : 'Analizar esta conversación'}</AsyncButton></div>}
          </div>)} />
    </>
  )
}
