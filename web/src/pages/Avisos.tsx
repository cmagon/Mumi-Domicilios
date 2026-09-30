import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'

type N = { id: string; tipo: string; titulo: string; detalle: string | null; pedido_id: string | null; telefono: string | null; leida: boolean; creado_en: string }
const ICONO: Record<string, string> = { pago: '💰', pago_revision: '🧾', atencion: '🙋', sin_respuesta: '❓', cambio: '✏️', pedido_grande: '📦' }
const ETIQUETA: Record<string, string> = { pago: 'Pago recibido', pago_revision: 'Revisar comprobante', atencion: 'Atención humana', sin_respuesta: 'El bot no pudo resolver', cambio: 'Pedido modificado', pedido_grande: 'Pedido grande' }

export default function Avisos() {
  const [items, setItems] = useState<N[]>([])
  const [soloPendientes, setSoloPendientes] = useState(true)
  const cargar = useCallback(async () => {
    const { data } = await supabase.from('notificaciones').select('*').order('creado_en', { ascending: false }).limit(150)
    setItems((data ?? []) as N[])
  }, [])
  useEffect(() => {
    cargar()
    const ch = supabase.channel('avisos-lista').on('postgres_changes', { event: '*', schema: 'public', table: 'notificaciones' }, () => cargar()).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [cargar])

  const leer = async (id: string) => { await supabase.from('notificaciones').update({ leida: true }).eq('id', id); cargar() }
  const leerTodas = async () => { await supabase.from('notificaciones').update({ leida: true }).eq('leida', false); cargar() }
  const lista = items.filter((n) => !soloPendientes || !n.leida)

  return (
    <>
      <div className="card"><div className="row">
        <select value={soloPendientes ? 'p' : 't'} onChange={(e) => setSoloPendientes(e.target.value === 'p')}>
          <option value="p">Pendientes</option><option value="t">Todos</option></select>
        <button className="sec" onClick={leerTodas}>Marcar todos como leídos</button></div></div>
      {lista.map((n) => (
        <div className="card" key={n.id} style={n.leida ? { opacity: 0.65 } : { borderLeft: '4px solid var(--s)' }}>
          <div className="row"><b>{ICONO[n.tipo] ?? '🔔'} {n.titulo}</b><span className="badge">{ETIQUETA[n.tipo] ?? n.tipo}</span></div>
          {n.detalle && <p>{n.detalle}</p>}
          <p className="muted">{new Date(n.creado_en).toLocaleString()}{n.telefono ? ` · chat ${n.telefono}` : ''}</p>
          <div className="row">
            {n.pedido_id && <Link to="/pedidos"><button className="sm">Ver pedidos</button></Link>}
            {!n.leida && <button className="sec sm" onClick={() => leer(n.id)}>Marcar leído</button>}
          </div>
        </div>))}
      {!lista.length && <p className="muted">Sin avisos.</p>}
    </>
  )
}
