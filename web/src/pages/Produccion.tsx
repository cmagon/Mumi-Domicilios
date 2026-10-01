import { useCallback, useEffect, useState } from 'react'
import { CalendarioGestion, SelectorFecha, useCalendario } from '../Calendario'
import { supabase } from '../supabase'
import { cop, hoy } from '../hooks'
import type { Pedido } from '../types'
import { imprimirTickets } from '../ticket'
import { AsyncButton, Modal, useToast } from '../ui'
import { etiquetaFecha } from '../pedidoFlow'

type Fila = {
  producto_id: string; nombre: string; activo: boolean; fabricadas: number; horneadas_total: number; comprometidas: number; disponible_general: number
  horneado_registrado: boolean; horneadas_dia: number; reservadas_dia: number; extras_dia: number; faltan_dia: number
}
type Lote = { id: string; producto_id: string; cantidad: number; nota: string | null; fecha: string; creado_en: string }

export default function Produccion() {
  const toast = useToast()
  const cal = useCalendario()
  const [calAbierto, setCalAbierto] = useState(false)
  const [fecha, setFecha] = useState(hoy())
  const [ajustado, setAjustado] = useState(false)
  // Al abrir, salta al día de producción más cercano (hoy si lo es)
  useEffect(() => { if (!ajustado && !cal.cargando) { setFecha(cal.ajustar(hoy())); setAjustado(true) } }, [ajustado, cal.cargando, cal.ajustar]) // eslint-disable-line
  const [filas, setFilas] = useState<Fila[]>([])
  const [lotes, setLotes] = useState<Lote[]>([])
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [enVivo, setEnVivo] = useState(false)
  const [modal, setModal] = useState<'fabricacion' | 'horneado' | null>(null)
  const [vals, setVals] = useState<Record<string, string>>({})
  const [nota, setNota] = useState('')

  const load = useCallback(async () => {
    const [r, l, o] = await Promise.all([
      supabase.rpc('stock_resumen', { p_fecha: fecha }),
      supabase.from('stock_lotes').select('*').order('creado_en', { ascending: false }).limit(12),
      supabase.from('pedidos').select('*, pedido_items(cantidad, producto_id, productos(nombre))').eq('fecha_entrega', fecha).neq('estado', 'cancelado').order('creado_en'),
    ])
    setFilas(((r.data ?? []) as Fila[]).filter((x) => x.activo).map((x) => ({ ...x, fabricadas: +x.fabricadas, horneadas_total: +x.horneadas_total, comprometidas: +x.comprometidas,
      disponible_general: +x.disponible_general, reservadas_dia: +x.reservadas_dia, extras_dia: +x.extras_dia, faltan_dia: +x.faltan_dia })))
    setLotes((l.data ?? []) as Lote[])
    setPedidos((o.data ?? []) as unknown as Pedido[])
  }, [fecha])
  useEffect(() => { load() }, [load])

  // Tiempo real: cada pedido del bot, horneado o fabricación actualiza los números sin recargar
  useEffect(() => {
    const ch = supabase.channel('stock-vivo-' + fecha)
    for (const tabla of ['stock_lotes', 'produccion_dia', 'pedidos', 'pedido_items'])
      ch.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, () => load())
    ch.subscribe((estado) => setEnVivo(estado === 'SUBSCRIBED'))
    return () => { supabase.removeChannel(ch) }
  }, [fecha, load])

  const esHoy = fecha === hoy()
  const registrado = filas.some((f) => f.horneado_registrado)

  // ---------- Fabricación (stock general) ----------
  const abrirFabricacion = () => { setVals({}); setNota(''); setModal('fabricacion') }
  const guardarFabricacion = async () => {
    const nuevos = filas.map((f) => ({ producto_id: f.producto_id, cantidad: parseInt(vals[f.producto_id] || '0', 10) || 0 })).filter((x) => x.cantidad !== 0)
    if (!nuevos.length) { toast('Escribe al menos una cantidad', 'err'); return false }
    const { error } = await supabase.from('stock_lotes').insert(nuevos.map((x) => ({ ...x, nota: nota || null })))
    if (error) { toast(error.message, 'err'); return false }
    toast(`Fabricación registrada (${nuevos.reduce((a, x) => a + x.cantidad, 0)} unidades)`)
    await load(); setTimeout(() => setModal(null), 450)
  }
  const borrarLote = async (l: Lote) => {
    const { error } = await supabase.from('stock_lotes').delete().eq('id', l.id)
    if (error) return toast(error.message, 'err')
    toast('Registro eliminado'); load()
  }

  // ---------- Horneado del día ----------
  const abrirHorneado = () => {
    setVals(Object.fromEntries(filas.map((f) => [f.producto_id, String(f.horneado_registrado ? f.horneadas_dia : f.reservadas_dia)])))
    setModal('horneado')
  }
  const guardarHorneado = async () => {
    const filasNuevas = filas.map((f) => ({ fecha, producto_id: f.producto_id, horneadas: Math.max(0, parseInt(vals[f.producto_id] || '0', 10) || 0), actualizado_en: new Date().toISOString() }))
    const { error } = await supabase.from('produccion_dia').upsert(filasNuevas, { onConflict: 'fecha,producto_id' })
    if (error) { toast(error.message, 'err'); return false }
    toast('Horneado del día registrado'); await load(); setTimeout(() => setModal(null), 450)
  }

  const imprimirTodos = async () => {
    const ids = pedidos.filter((o) => ['recibido', 'pago_verificado', 'pendiente_cobro'].includes(o.estado)).map((o) => o.id)
    imprimirTickets(pedidos)
    if (ids.length) { await supabase.from('pedidos').update({ estado: 'impreso' }).in('id', ids); load() }
    toast(`${pedidos.length} ticket${pedidos.length === 1 ? '' : 's'} enviado${pedidos.length === 1 ? '' : 's'} a imprimir`)
  }
  const porProducir = (pid: string) => pedidos.reduce((a, o) => a + (o.pedido_items ?? []).filter((i) => i.producto_id === pid).reduce((x, i) => x + i.cantidad, 0), 0)

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ margin: 0, flex: '1 1 auto' }}>Producción {enVivo ? <span className="badge ok">● en vivo</span> : <span className="badge warn">sin conexión en vivo</span>}</h2>
      </div>

      {/* 1. Stock general */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, flex: '1 1 auto' }}>❄️ Stock general (fabricado / congelado)</h2>
          <button onClick={abrirFabricacion}>+ Registrar fabricación</button>
        </div>
        <p className="muted">Lo que se fabrica y se congela. El bot agenda pedidos para las próximas entregas con este stock.</p>
        <div className="stock-grid">
          {filas.map((f) => (
            <div key={f.producto_id} className={`stock-item ${f.disponible_general === 0 ? 'cero' : ''}`}>
              <div className="stock-nombre">{f.nombre}</div>
              <div className="stock-num" key={f.disponible_general}>{f.disponible_general}</div>
              <div className="muted">para agendar</div>
              <div className="stock-detalle">{f.fabricadas} fabricadas · {f.horneadas_total} horneadas · {f.comprometidas} agendadas</div>
            </div>))}
        </div>
        {lotes.length > 0 && (
          <details style={{ marginTop: 10 }}><summary>Últimos registros de fabricación</summary>
            {lotes.map((l) => (
              <div key={l.id} className="fila-item" style={{ padding: '4px 0' }}>
                <span className="crece">{l.cantidad > 0 ? '+' : ''}{l.cantidad} {filas.find((f) => f.producto_id === l.producto_id)?.nombre ?? 'sabor'} <span className="muted">· {l.fecha}{l.nota ? ` · ${l.nota}` : ''}</span></span>
                <button className="sec sm" onClick={() => borrarLote(l)} aria-label="Eliminar registro">🗑</button>
              </div>))}
          </details>)}
      </div>

      {/* 2. Horneado del día */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, flex: '1 1 auto' }}>🔥 Horneado del día</h2>
          <button onClick={abrirHorneado}>{registrado ? 'Editar horneado' : 'Registrar horneado'}</button>
        </div>
        <div className="row" style={{ alignItems: 'end' }}>
          <div><label>Día de producción (entrega)</label><SelectorFecha valor={fecha} onChange={setFecha} /></div>
          <div style={{ paddingBottom: 2 }}><button className="sec" onClick={() => setCalAbierto(true)}>📅 Calendario</button></div>
          <div className="muted" style={{ paddingBottom: 10 }}>{etiquetaFecha(fecha)}</div>
        </div>
        {!registrado && <p className="muted">Aún no registras cuántas se hornean este día. Mientras tanto el bot no ofrece galletas para entrega el mismo día; solo agenda.</p>}
        <div className="stock-grid">
          {filas.map((f) => (
            <div key={f.producto_id} className={`stock-item ${registrado && f.extras_dia === 0 ? 'cero' : ''}`}>
              <div className="stock-nombre">{f.nombre}</div>
              {registrado
                ? <><div className="stock-num" key={f.extras_dia}>{f.extras_dia}</div><div className="muted">extras disponibles</div></>
                : <><div className="stock-num" style={{ color: 'var(--mut)' }}>—</div><div className="muted">sin registrar</div></>}
              <div className="stock-detalle">{f.reservadas_dia} reservadas{registrado ? ` · ${f.horneadas_dia} horneadas` : ''} · a producir {porProducir(f.producto_id)}</div>
              {f.faltan_dia > 0 && <span className="badge rojo">Faltan {f.faltan_dia} para cubrir lo reservado</span>}
            </div>))}
        </div>
        <p className="muted">Extras = horneadas − reservadas. Cada pedido del bot para este día los descuenta al instante; cancelar o eliminar un pedido los devuelve.</p>
      </div>

      <div className="card"><h2>Pedidos del día ({pedidos.length})</h2>
        <AsyncButton okText="Enviados" disabled={!pedidos.length} onClick={imprimirTodos}>Imprimir todos los tickets</AsyncButton>
        {pedidos.map((o) => (<p key={o.id}>#{o.numero} · {o.cliente_nombre} · <span className="badge">{o.estado}</span> · {cop(o.total)}</p>))}
        {esHoy && pedidos.length === 0 && <p className="muted">Sin pedidos para hoy.</p>}
      </div>

      <Modal abierto={modal === 'fabricacion'} titulo="Registrar fabricación" onClose={() => setModal(null)}
        pie={<><button className="sec" onClick={() => setModal(null)}>Cancelar</button><AsyncButton okText="Registrado" onClick={guardarFabricacion}>Guardar</AsyncButton></>}>
        <p className="muted">¿Cuántas fabricaste (y congelaste) de cada sabor? Se suman al stock general. Usa un número negativo para corregir o descontar mermas.</p>
        {filas.map((f) => (
          <div className="fila-item" key={f.producto_id} style={{ marginBottom: 6 }}>
            <span className="crece">{f.nombre} <span className="muted">(hay {f.disponible_general})</span></span>
            <input style={{ width: 96 }} type="number" inputMode="numeric" placeholder="0" value={vals[f.producto_id] ?? ''} onChange={(e) => setVals({ ...vals, [f.producto_id]: e.target.value })} />
          </div>))}
        <label>Nota (opcional)</label><input placeholder="ej. lote del martes" value={nota} onChange={(e) => setNota(e.target.value)} />
      </Modal>

      <Modal abierto={modal === 'horneado'} titulo={`Horneado · ${etiquetaFecha(fecha)}`} onClose={() => setModal(null)}
        pie={<><button className="sec" onClick={() => setModal(null)}>Cancelar</button><AsyncButton okText="Guardado" onClick={guardarHorneado}>Guardar horneado</AsyncButton></>}>
        <p className="muted">Escribe el <b>total</b> que hornearás de cada sabor, incluyendo lo ya reservado. La diferencia son los extras que el bot ofrece en el horario de entregas.</p>
        {filas.map((f) => {
          const tot = parseInt(vals[f.producto_id] || '0', 10) || 0
          const extras = tot - f.reservadas_dia
          return (
            <div className="fila-item" key={f.producto_id} style={{ marginBottom: 8 }}>
              <span className="crece">{f.nombre}<div className="muted">{f.reservadas_dia} reservadas · <b style={{ color: extras < 0 ? '#b00020' : 'inherit' }}>{extras < 0 ? `faltan ${-extras}` : `${extras} extras`}</b></div></span>
              <input style={{ width: 96 }} type="number" min={0} inputMode="numeric" value={vals[f.producto_id] ?? ''} onChange={(e) => setVals({ ...vals, [f.producto_id]: e.target.value })} />
            </div>)
        })}
      </Modal>
      <CalendarioGestion abierto={calAbierto} onClose={() => setCalAbierto(false)} />
    </>
  )
}
