import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { cop } from '../hooks'
import { ESTADOS, type Pedido } from '../types'
import { imprimirTickets } from '../ticket'

export default function Pedidos() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [filtro, setFiltro] = useState('activos')
  const [comp, setComp] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const { data } = await supabase.from('pedidos')
      .select('*, pedido_items(cantidad, producto_id, productos(nombre))')
      .order('creado_en', { ascending: false }).limit(100)
    setPedidos((data ?? []) as unknown as Pedido[])
  }, [])

  useEffect(() => {
    load()
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
    const ch = supabase.channel('pedidos-vivo')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos' }, (p) => {
        load()
        if ('Notification' in window && Notification.permission === 'granted')
          new Notification('Nuevo pedido Mumi', { body: `#${p.new.numero} · ${p.new.cliente_nombre}` })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const cambiar = async (id: string, estado: string) => {
    await supabase.from('pedidos').update({ estado, ...(estado === 'pago_verificado' ? { pagado: true } : {}) }).eq('id', id)
    load()
  }
  const verComprobante = async (o: Pedido) => {
    if (!o.comprobante_url) return
    const { data } = await supabase.storage.from('comprobantes').createSignedUrl(o.comprobante_url, 300)
    if (data) setComp({ ...comp, [o.id]: data.signedUrl })
  }
  const lista = pedidos.filter((o) => filtro === 'todos' || !['entregado', 'cancelado'].includes(o.estado))

  return (
    <>
      <div className="card"><select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
        <option value="activos">Activos</option><option value="todos">Todos</option></select></div>
      {lista.map((o) => (
        <div className="card" key={o.id}>
          <div className="row"><b>#{o.numero} · {o.cliente_nombre}</b>
            <span className={'badge ' + (o.estado === 'entregado' ? 'ok' : 'warn')}>{o.estado}</span>
            <span className="badge">{o.origen}</span></div>
          <p className="muted">Tel {o.cliente_telefono} · {o.modalidad}{o.direccion ? ` · ${o.direccion}` : ''}
            {o.fecha_entrega ? ` · ${o.fecha_entrega} ${o.franja_horaria ?? ''}` : ''}</p>
          <ul>{(o.pedido_items ?? []).map((i, k) => <li key={k}>{i.cantidad} × {i.productos?.nombre}</li>)}</ul>
          <p>{cop(o.total)} · {o.metodo_pago} · {o.pagado ? 'pagado' : 'sin pagar'}</p>
          {o.nota && <p><b>Nota:</b> {o.nota}</p>}
          {o.comprobante_url && (comp[o.id]
            ? <a href={comp[o.id]} target="_blank"><img className="thumb" src={comp[o.id]} alt="comprobante" /></a>
            : <button className="sec sm" onClick={() => verComprobante(o)}>Ver comprobante de pago</button>)}
          <div className="row" style={{ marginTop: 8 }}>
            <select value={o.estado} onChange={(e) => cambiar(o.id, e.target.value)}>
              {ESTADOS.map((e) => <option key={e}>{e}</option>)}</select>
            {o.estado === 'recibido' && o.metodo_pago?.toLowerCase().includes('nequi') &&
              <button className="sm" onClick={() => cambiar(o.id, 'pago_verificado')}>Aprobar pago</button>}
            <button className="sec sm" onClick={() => imprimirTickets([o])}>Reimprimir</button></div>
        </div>))}
    </>
  )
}
