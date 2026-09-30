import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { cop, hoy } from '../hooks'
import type { Producto, Stock, Pedido } from '../types'
import { imprimirTickets } from '../ticket'
import { AsyncButton, useToast } from '../ui'

export default function Produccion() {
  const toast = useToast()
  const [fecha, setFecha] = useState(hoy())
  const [prods, setProds] = useState<Producto[]>([])
  const [stock, setStock] = useState<Record<string, Stock>>({})
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [exc, setExc] = useState<Record<string, string>>({})
  const [enVivo, setEnVivo] = useState(false)
  const editando = useRef<Set<string>>(new Set()) // campos que el admin está tocando: no se pisan con datos en vivo

  const load = useCallback(async () => {
    const [p, s, o] = await Promise.all([
      supabase.from('productos').select('*').eq('activo', true).order('nombre'),
      supabase.from('stock_dia').select('*').eq('fecha', fecha),
      supabase.from('pedidos').select('*, pedido_items(cantidad, producto_id, productos(nombre))')
        .eq('fecha_entrega', fecha).neq('estado', 'cancelado').order('creado_en'),
    ])
    setProds(p.data ?? [])
    const m: Record<string, Stock> = {}; (s.data ?? []).forEach((r) => (m[r.producto_id] = r)); setStock(m)
    setExc((prev) => {
      const next: Record<string, string> = {}
      ;(s.data ?? []).forEach((r) => { next[r.producto_id] = editando.current.has(r.producto_id) ? (prev[r.producto_id] ?? String(r.cantidad_excedente)) : String(r.cantidad_excedente) })
      return next
    })
    setPedidos((o.data ?? []) as unknown as Pedido[])
  }, [fecha])
  useEffect(() => { load() }, [load])

  // Tiempo real: cada pedido del bot o ajuste de stock actualiza esta pantalla sin recargar
  useEffect(() => {
    const ch = supabase.channel('stock-vivo-' + fecha)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_dia' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedido_items' }, () => load())
      .subscribe((estado) => setEnVivo(estado === 'SUBSCRIBED'))
    return () => { supabase.removeChannel(ch) }
  }, [fecha, load])

  const guardar = async (pid: string) => {
    const cantidad_excedente = Math.max(0, parseInt(exc[pid] || '0', 10) || 0)
    editando.current.delete(pid)
    const cur = stock[pid]
    const { error } = cur
      ? await supabase.from('stock_dia').update({ cantidad_excedente }).eq('id', cur.id)
      : await supabase.from('stock_dia').insert({ fecha, producto_id: pid, cantidad_excedente })
    if (error) { toast(error.message, 'err'); return false }
    toast(`Stock de ${prods.find((p) => p.id === pid)?.nombre ?? 'sabor'} actualizado: ${cantidad_excedente}`)
    load()
  }
  const porProducir = (pid: string) => pedidos.reduce((a, o) =>
    a + (o.pedido_items ?? []).filter((i) => i.producto_id === pid).reduce((x, i) => x + i.cantidad, 0), 0)
  const imprimirTodos = async () => {
    const ids = pedidos.filter((o) => o.estado === 'recibido' || o.estado === 'pago_verificado' || o.estado === 'pendiente_cobro').map((o) => o.id)
    imprimirTickets(pedidos)
    if (ids.length) { await supabase.from('pedidos').update({ estado: 'impreso' }).in('id', ids); load() }
    toast(`${pedidos.length} ticket${pedidos.length === 1 ? '' : 's'} enviado${pedidos.length === 1 ? '' : 's'} a imprimir`)
  }

  return (
    <>
      <div className="card"><label>Fecha de producción</label>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
      <div className="card"><h2>Stock en vivo {enVivo ? <span className="badge ok">● en vivo</span> : <span className="badge warn">sin conexión en vivo</span>}</h2>
        <table><thead><tr><th>Sabor</th><th>Vendidas</th><th>Quedan</th><th>Total</th><th>A producir</th></tr></thead>
          <tbody>{prods.map((p) => {
            const s = stock[p.id]
            const quedan = s?.cantidad_excedente ?? 0
            return (<tr key={p.id}><td>{p.nombre}</td><td>{s?.cantidad_agendada ?? 0}</td>
              <td><div className="row"><input type="number" min={0} value={exc[p.id] ?? '0'} style={quedan === 0 && s ? { borderColor: '#b00020' } : undefined}
                onChange={(e) => { editando.current.add(p.id); setExc({ ...exc, [p.id]: e.target.value }) }} />
                <AsyncButton className="sm" okText="" onClick={() => guardar(p.id)}>OK</AsyncButton></div>
                {s && quedan === 0 && <span className="badge warn">agotado</span>}</td>
              <td>{(s?.cantidad_agendada ?? 0) + quedan}</td><td><b>{porProducir(p.id)}</b></td></tr>)
          })}</tbody></table>
        <p className="muted">Cada pedido del bot pasa unidades de "Quedan" a "Vendidas" al instante; el total no cambia. "Quedan" es lo único que editas (cupo libre para pedidos).</p>
      </div>
      <div className="card"><h2>Pedidos del día ({pedidos.length})</h2>
        <AsyncButton okText="Enviados" disabled={!pedidos.length} onClick={imprimirTodos}>Imprimir todos los tickets</AsyncButton>
        {pedidos.map((o) => (<p key={o.id}>#{o.numero} · {o.cliente_nombre} · <span className="badge">{o.estado}</span> · {cop(o.total)}</p>))}
      </div>
    </>
  )
}
