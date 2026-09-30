import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { cop } from '../hooks'
import { ESTADOS, type Pedido } from '../types'
import { imprimirTickets } from '../ticket'

export default function Pedidos() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [filtro, setFiltro] = useState('activos')
  const [msg, setMsg] = useState('')
  const [comp, setComp] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const { data } = await supabase.from('pedidos')
      .select('*, pedido_items(cantidad, producto_id, productos(nombre))')
      .order('creado_en', { ascending: false }).limit(100)
    const lista = (data ?? []) as unknown as Pedido[]
    setPedidos(lista)
    // Soporte de pago adjunto: URLs firmadas (5 min) para mostrarlo sin clic
    const rutas = lista.map((o) => o.comprobante_url).filter(Boolean) as string[]
    if (rutas.length) {
      const { data: firmadas } = await supabase.storage.from('comprobantes').createSignedUrls(rutas, 3600)
      const porRuta = new Map((firmadas ?? []).map((f) => [f.path, f.signedUrl]))
      setComp(Object.fromEntries(lista.filter((o) => o.comprobante_url && porRuta.get(o.comprobante_url)).map((o) => [o.id, porRuta.get(o.comprobante_url!)!])))
    }
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
  const lista = pedidos.filter((o) => filtro === 'todos' || !['entregado', 'cancelado'].includes(o.estado))

  return (
    <>
      {msg && <p className="muted">{msg}</p>}
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
          {o.direccion_aprox && <p>📍 <b>Dirección aproximada</b> (ubicación compartida){o.lat != null && <> · <a href={`https://www.google.com/maps?q=${o.lat},${o.lng}`} target="_blank">Ver en el mapa</a></>}</p>}
          {o.comprobante_url && comp[o.id] && (
            <div><span className="muted">Soporte de pago:</span><br />
              <a href={comp[o.id]} target="_blank"><img src={comp[o.id]} alt="comprobante de pago" style={{ maxHeight: 180, maxWidth: '100%', borderRadius: 8, border: '1px solid var(--bd)' }} /></a></div>)}
          {!o.comprobante_url && o.metodo_pago && !/efectivo/i.test(o.metodo_pago) && !o.pagado && <p className="err">Sin soporte de pago todavía</p>}
          <div className="row" style={{ marginTop: 8 }}>
            <select value={o.estado} onChange={(e) => cambiar(o.id, e.target.value)}>
              {ESTADOS.map((e) => <option key={e}>{e}</option>)}</select>
            {o.estado === 'recibido' && o.metodo_pago?.toLowerCase().includes('nequi') &&
              <button className="sm" onClick={() => cambiar(o.id, 'pago_verificado')}>Aprobar pago</button>}
            <button className="sec sm" onClick={async () => { await supabase.from('pedidos').update({ reimprimir: true }).eq('id', o.id); setMsg(`Reimpresión de #${o.numero} enviada a la impresora`) }}>Reimprimir</button>
            <button className="sec sm" onClick={() => imprimirTickets([o])}>Imprimir (navegador)</button></div>
        </div>))}
    </>
  )
}
