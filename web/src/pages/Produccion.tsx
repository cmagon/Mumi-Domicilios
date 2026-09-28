import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { cop, hoy } from '../hooks'
import type { Producto, Stock, Pedido } from '../types'
import { imprimirTickets } from '../ticket'

export default function Produccion() {
  const [fecha, setFecha] = useState(hoy())
  const [prods, setProds] = useState<Producto[]>([])
  const [stock, setStock] = useState<Record<string, Stock>>({})
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [exc, setExc] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const [p, s, o] = await Promise.all([
      supabase.from('productos').select('*').eq('activo', true).order('nombre'),
      supabase.from('stock_dia').select('*').eq('fecha', fecha),
      supabase.from('pedidos').select('*, pedido_items(cantidad, producto_id, productos(nombre))')
        .eq('fecha_entrega', fecha).neq('estado', 'cancelado').order('creado_en'),
    ])
    setProds(p.data ?? [])
    const m: Record<string, Stock> = {}; (s.data ?? []).forEach((r) => (m[r.producto_id] = r)); setStock(m)
    setExc(Object.fromEntries((s.data ?? []).map((r) => [r.producto_id, String(r.cantidad_excedente)])))
    setPedidos((o.data ?? []) as unknown as Pedido[])
  }, [fecha])
  useEffect(() => { load() }, [load])

  const guardar = async (pid: string) => {
    const cantidad_excedente = Math.max(0, parseInt(exc[pid] || '0', 10) || 0)
    const cur = stock[pid]
    if (cur) await supabase.from('stock_dia').update({ cantidad_excedente }).eq('id', cur.id)
    else await supabase.from('stock_dia').insert({ fecha, producto_id: pid, cantidad_excedente })
    load()
  }
  const porProducir = (pid: string) => pedidos.reduce((a, o) =>
    a + (o.pedido_items ?? []).filter((i) => i.producto_id === pid).reduce((x, i) => x + i.cantidad, 0), 0)
  const imprimirTodos = async () => {
    const ids = pedidos.filter((o) => o.estado === 'recibido' || o.estado === 'pago_verificado' || o.estado === 'pendiente_cobro').map((o) => o.id)
    imprimirTickets(pedidos)
    if (ids.length) { await supabase.from('pedidos').update({ estado: 'impreso' }).in('id', ids); load() }
  }

  return (
    <>
      <div className="card"><label>Fecha de producción</label>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
      <div className="card"><h2>Stock y total a producir</h2>
        <table><thead><tr><th>Sabor</th><th>Agendado</th><th>Excedente</th><th>Total disp.</th><th>A producir</th></tr></thead>
          <tbody>{prods.map((p) => {
            const s = stock[p.id]
            return (<tr key={p.id}><td>{p.nombre}</td><td>{s?.cantidad_agendada ?? 0}</td>
              <td><div className="row"><input type="number" min={0} value={exc[p.id] ?? '0'}
                onChange={(e) => setExc({ ...exc, [p.id]: e.target.value })} />
                <button className="sm" onClick={() => guardar(p.id)}>OK</button></div></td>
              <td>{(s?.cantidad_agendada ?? 0) + (s?.cantidad_excedente ?? 0)}</td><td><b>{porProducir(p.id)}</b></td></tr>)
          })}</tbody></table>
        <p className="muted">Total disponible = agendado (fijo) + excedente (único campo editable).</p>
      </div>
      <div className="card"><h2>Pedidos del día ({pedidos.length})</h2>
        <button onClick={imprimirTodos} disabled={!pedidos.length}>Imprimir todos los tickets</button>
        {pedidos.map((o) => (<p key={o.id}>#{o.numero} · {o.cliente_nombre} · <span className="badge">{o.estado}</span> · {cop(o.total)}</p>))}
      </div>
    </>
  )
}
