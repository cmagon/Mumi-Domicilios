import { useEffect, useMemo, useState } from 'react'
import { Banknote, Bot, Clock, ShoppingBag, TrendingDown, TrendingUp, Trophy, Users } from 'lucide-react'
import { Info } from '../ui'
import { supabase } from '../supabase'
import { cop } from '../hooks'

type Ped = { id: string; total: number; estado: string; origen: string; metodo_pago: string | null; fecha_entrega: string; creado_en: string; cliente_telefono: string; pagado: boolean }
type Item = { producto_id: string; cantidad: number; pedido_id: string }
type Hor = { fecha: string; producto_id: string; horneadas: number }
type Periodo = 'hoy' | '7' | '30'
const TZ = 'America/Bogota'
const dia = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const suma = (f: string, n: number) => new Date(new Date(f + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10)
const horaCO = (iso: string) => Number(new Date(iso).toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false })) % 24
const COLORES_PAGO = ['#6e140d', '#ad342b', '#e08a1e', '#1e7d32', '#4b2a78']

// Tablero de indicadores: ventas, ticket promedio, bot, curva por hora, medios de pago y ranking de sabores
export default function Kpis() {
  const [periodo, setPeriodo] = useState<Periodo>('hoy')
  const [peds, setPeds] = useState<Ped[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [hor, setHor] = useState<Hor[]>([])
  const [prods, setProds] = useState<{ id: string; nombre: string }[]>([])
  const [dem, setDem] = useState<{ producto_id: string | null; cantidad: number }[]>([])
  const [ses, setSes] = useState<{ vendida: boolean }[]>([])
  const [cargado, setCargado] = useState(false)

  useEffect(() => { (async () => {
    const hoyF = dia(new Date()), desde = suma(hoyF, -60)
    const [p, i, h, pr, d, s] = await Promise.all([
      supabase.from('pedidos').select('id,total,estado,origen,metodo_pago,fecha_entrega,creado_en,cliente_telefono,pagado').gte('fecha_entrega', desde).limit(5000),
      supabase.from('pedido_items').select('producto_id,cantidad,pedido_id,pedidos!inner(fecha_entrega)').gte('pedidos.fecha_entrega', desde).limit(20000),
      supabase.from('produccion_dia').select('fecha,producto_id,horneadas').gte('fecha', desde),
      supabase.from('productos').select('id,nombre'),
      supabase.from('demanda_insatisfecha').select('producto_id,cantidad').gte('fecha', desde),
      supabase.from('chat_sesiones').select('vendida').gte('inicio', new Date(Date.now() - 60 * 86400000).toISOString()).limit(5000),
    ])
    setPeds((p.data ?? []) as Ped[]); setItems((i.data ?? []) as unknown as Item[]); setHor((h.data ?? []) as Hor[]); setProds(pr.data ?? [])
    setDem((d.data ?? []) as never); setSes((s.data ?? []) as never); setCargado(true)
  })() }, [])

  const k = useMemo(() => {
    const hoyF = dia(new Date()), n = periodo === 'hoy' ? 1 : Number(periodo)
    const ini = suma(hoyF, -(n - 1)), iniPrev = suma(ini, -n)
    const vivos = peds.filter((x) => x.estado !== 'cancelado')
    const act = vivos.filter((x) => x.fecha_entrega >= ini && x.fecha_entrega <= hoyF)
    const prev = vivos.filter((x) => x.fecha_entrega >= iniPrev && x.fecha_entrega < ini)
    const ventas = act.reduce((t, x) => t + x.total, 0), ventasPrev = prev.reduce((t, x) => t + x.total, 0)
    const delta = ventasPrev > 0 ? Math.round(((ventas - ventasPrev) / ventasPrev) * 1000) / 10 : null
    const ticket = act.length ? Math.round(ventas / act.length) : 0
    const bot = act.filter((x) => x.origen === 'bot').length
    const entregados = act.filter((x) => x.estado === 'entregado').length
    const cancelados = peds.filter((x) => x.estado === 'cancelado' && x.fecha_entrega >= ini && x.fecha_entrega <= hoyF).length
    const pagados = act.filter((x) => x.pagado).length
    // clientes nuevos / recurrentes (en todo el histórico cargado)
    const cnt: Record<string, number> = {}; vivos.forEach((x) => (cnt[x.cliente_telefono] = (cnt[x.cliente_telefono] ?? 0) + 1))
    const telsAct = new Set(act.map((x) => x.cliente_telefono))
    const nuevos = [...telsAct].filter((t) => cnt[t] === 1).length, recurrentes = telsAct.size - nuevos
    // curva por hora (hora en que se hizo el pedido)
    const horas: Record<number, number> = {}; act.forEach((x) => { const h = horaCO(x.creado_en); horas[h] = (horas[h] ?? 0) + 1 })
    const hs = Object.keys(horas).map(Number).sort((a, b) => a - b)
    const rango = hs.length ? Array.from({ length: hs[hs.length - 1] - hs[0] + 1 }, (_, i) => hs[0] + i) : []
    const curva = rango.map((h) => ({ h, n: horas[h] ?? 0 }))
    // medios de pago
    const pagos: Record<string, number> = {}; act.forEach((x) => { const m = x.metodo_pago || 'Sin método'; pagos[m] = (pagos[m] ?? 0) + x.total })
    const medios = Object.entries(pagos).sort((a, b) => b[1] - a[1])
    // ranking de sabores del periodo con lote horneado
    const ids = new Set(act.map((x) => x.id))
    const vend: Record<string, number> = {}; items.forEach((i) => { if (ids.has(i.pedido_id)) vend[i.producto_id] = (vend[i.producto_id] ?? 0) + i.cantidad })
    const lote: Record<string, number> = {}; hor.filter((x) => x.fecha >= ini && x.fecha <= hoyF).forEach((x) => (lote[x.producto_id] = (lote[x.producto_id] ?? 0) + x.horneadas))
    const sinStock: Record<string, number> = {}; dem.forEach((x) => { if (x.producto_id) sinStock[x.producto_id] = (sinStock[x.producto_id] ?? 0) + x.cantidad })
    const ranking = prods.map((p) => ({ id: p.id, nombre: p.nombre, vendidas: vend[p.id] ?? 0, lote: lote[p.id] ?? 0, sinStock: sinStock[p.id] ?? 0 })).sort((a, b) => b.vendidas - a.vendidas)
    const cerradas = ses.length, ventasChat = ses.filter((s) => s.vendida).length
    return { ventas, delta, ticket, nPedidos: act.length, bot, entregados, cancelados, pagados, nuevos, recurrentes, curva, medios, ranking, convChat: cerradas ? Math.round((ventasChat / cerradas) * 100) : 0 }
  }, [peds, items, hor, prods, dem, ses, periodo])

  const maxCurva = Math.max(1, ...k.curva.map((c) => c.n)), pico = k.curva.reduce((m, c) => (c.n > m.n ? c : m), { h: -1, n: 0 })
  const totalPagos = k.medios.reduce((t, [, v]) => t + v, 0) || 1
  const maxVend = Math.max(1, ...k.ranking.map((r) => r.vendidas))
  const etiquetaHora = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? ' a. m.' : ' p. m.'}`

  return (
    <div className="kpis-pg">
      <div className="kpis-cab">
        <div><div className="kpis-sobre">Indicadores del negocio</div><h2 style={{ margin: 0 }}>Resumen {periodo === 'hoy' ? 'de hoy' : `de los últimos ${periodo} días`}</h2></div>
        <div className="chips" role="group" aria-label="Periodo">
          {([['hoy', 'Hoy'], ['7', '7 días'], ['30', '30 días']] as [Periodo, string][]).map(([v, l]) => <button key={v} className={`chip ${periodo === v ? 'on' : ''}`} aria-pressed={periodo === v} onClick={() => setPeriodo(v)}>{l}</button>)}
        </div>
      </div>
      {!cargado && <p className="muted">Cargando…</p>}

      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-ico verde"><Banknote size={20} aria-hidden /></div><div className="muted">Ventas totales</div><div className="kpi-valor">{cop(k.ventas)}</div>
          {k.delta != null ? <div className={`kpi-delta ${k.delta >= 0 ? 'sube' : 'baja'}`}>{k.delta >= 0 ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />} {k.delta >= 0 ? '+' : ''}{k.delta}% vs periodo anterior</div> : <div className="muted">Sin periodo anterior para comparar</div>}</div>
        <div className="kpi-card"><div className="kpi-ico azul"><ShoppingBag size={20} aria-hidden /></div><div className="muted">Ticket promedio</div><div className="kpi-valor">{cop(k.ticket)}</div>
          <div className="muted">Basado en <b>{k.nPedidos}</b> pedido{k.nPedidos === 1 ? '' : 's'}</div></div>
        <div className="kpi-card"><div className="kpi-ico ambar"><Clock size={20} aria-hidden /></div><div className="muted">Entregados</div><div className="kpi-valor">{k.entregados}<span className="kpi-sub"> / {k.nPedidos}</span></div>
          <div className="muted">{k.pagados} pagados · {k.cancelados} cancelado{k.cancelados === 1 ? '' : 's'}</div></div>
        <div className="kpi-card"><div className="kpi-ico verde"><Bot size={20} aria-hidden /></div><div className="muted">Pedidos por el bot</div><div className="kpi-valor">{k.nPedidos ? Math.round((k.bot / k.nPedidos) * 100) : 0}%</div>
          <div className="muted">{k.bot} del bot · {k.nPedidos - k.bot} manuales · {k.convChat}% de las conversaciones terminan en venta</div></div>
        <div className="kpi-card"><div className="kpi-ico morado"><Users size={20} aria-hidden /></div><div className="muted">Clientes nuevos / recurrentes</div><div className="kpi-valor">{k.nuevos} <span className="kpi-sub">/ {k.recurrentes}</span></div>
          <div className="muted">Entre quienes pidieron en este periodo</div></div>
      </div>

      <div className="card">
        <h2>Pedidos por hora</h2>
        {k.curva.length ? <>
          <p className="muted">{pico.n ? `Hora con más pedidos: ${etiquetaHora(pico.h)} (${pico.n}).` : ''}</p>
          <div className="curva" role="img" aria-label={`Pedidos por hora. ${k.curva.map((c) => `${etiquetaHora(c.h)}: ${c.n}`).join(', ')}`}>
            {k.curva.map((c) => (
              <div className="curva-col" key={c.h}>
                <span className="curva-n">{c.n}</span>
                <div className={`curva-barra ${c.h === pico.h && c.n > 0 ? 'pico' : ''}`} style={{ height: `${Math.max(4, (c.n / maxCurva) * 100)}%` }} />
                <span className="curva-h">{c.h % 12 === 0 ? 12 : c.h % 12}{c.h < 12 ? 'a' : 'p'}</span>
              </div>))}
          </div></> : <p className="muted">Aún no hay pedidos en este periodo.</p>}
      </div>

      <div className="card">
        <h2>Medios de pago</h2>
        {k.medios.length ? k.medios.map(([m, v], i) => (
          <div className="pago-fila" key={m}>
            <div className="pago-linea"><b>{m}</b><span>{cop(v)} ({Math.round((v / totalPagos) * 100)}%)</span></div>
            <div className="pista"><div className="relleno" style={{ width: `${(v / totalPagos) * 100}%`, background: COLORES_PAGO[i % COLORES_PAGO.length] }} /></div>
          </div>)) : <p className="muted">Aún no hay ventas en este periodo.</p>}
      </div>

      <div className="card">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Trophy size={20} aria-hidden /> Sabores más vendidos</h2>
        {k.ranking.map((r, i) => (
          <div className="rank-fila" key={r.id}>
            <div className="pago-linea"><span><span className="rank-n">{i + 1}</span> <b>{r.nombre}</b></span><span>{r.vendidas} u.</span></div>
            <div className="pista"><div className="relleno" style={{ width: `${(r.vendidas / maxVend) * 100}%` }} /></div>
            <div className="rank-pie muted"><span>Horneadas en el periodo: {r.lote}</span><span>Quedan: <b>{Math.max(0, r.lote - r.vendidas)}</b>{r.sinStock ? ` · pedidas sin stock: ${r.sinStock}` : ''}</span></div>
          </div>))}
        {!k.ranking.length && <p className="muted">Aún no hay sabores.</p>}
        <Info bloque>"Quedan" compara lo horneado con lo vendido en el periodo. "Pedidas sin stock" suma las unidades que los clientes pidieron cuando el sabor no alcanzaba (las registra el bot).</Info>
      </div>
    </div>
  )
}
