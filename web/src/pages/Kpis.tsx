import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

type Sabor = { nombre: string; vendidas: number; sobrante: number }
export default function Kpis() {
  const [sabores, setSabores] = useState<Sabor[]>([])
  const [pctHumano, setPctHumano] = useState(0)
  const [nuevos, setNuevos] = useState(0)
  const [recurrentes, setRecurrentes] = useState(0)

  useEffect(() => { (async () => {
    const [{ data: prods }, { data: items }, { data: peds }, { data: stock }] = await Promise.all([
      supabase.from('productos').select('id,nombre'),
      supabase.from('pedido_items').select('producto_id,cantidad,pedidos(estado)'),
      supabase.from('pedidos').select('origen,cliente_telefono,estado'),
      supabase.from('stock_dia').select('producto_id,total_disponible,fecha').lt('fecha', new Date().toLocaleDateString('en-CA')),
    ])
    const vend: Record<string, number> = {}
    ;(items ?? []).forEach((i: any) => { if (i.pedidos?.estado !== 'cancelado') vend[i.producto_id] = (vend[i.producto_id] ?? 0) + i.cantidad })
    const disp: Record<string, number> = {}
    ;(stock ?? []).forEach((s) => (disp[s.producto_id] = (disp[s.producto_id] ?? 0) + s.total_disponible))
    setSabores((prods ?? []).map((p) => ({ nombre: p.nombre, vendidas: vend[p.id] ?? 0, sobrante: Math.max(0, (disp[p.id] ?? 0) - (vend[p.id] ?? 0)) })))
    const vivos = (peds ?? []).filter((p) => p.estado !== 'cancelado')
    setPctHumano(vivos.length ? Math.round((vivos.filter((p) => p.origen === 'manual').length / vivos.length) * 100) : 0)
    const cnt: Record<string, number> = {}; vivos.forEach((p) => (cnt[p.cliente_telefono] = (cnt[p.cliente_telefono] ?? 0) + 1))
    const v = Object.values(cnt); setNuevos(v.filter((n) => n === 1).length); setRecurrentes(v.filter((n) => n > 1).length)
  })() }, [])

  const ord = [...sabores].sort((a, b) => b.vendidas - a.vendidas)
  return (
    <div className="kpi">
      <div className="card"><div className="muted">Pedidos con intervención humana</div><div className="big">{pctHumano}%</div></div>
      <div className="card"><div className="muted">Clientes nuevos / recurrentes</div><div className="big">{nuevos} / {recurrentes}</div></div>
      <div className="card"><div className="muted">Más vendido</div><div className="big">{ord[0]?.nombre ?? '—'}</div>
        <div className="muted">Menos vendido: {ord.at(-1)?.nombre ?? '—'}</div></div>
      <div className="card" style={{ gridColumn: '1/-1' }}><h2>Por sabor</h2>
        <table><thead><tr><th>Sabor</th><th>Vendidas</th><th>Sobrante (días pasados)</th></tr></thead>
          <tbody>{sabores.map((s) => <tr key={s.nombre}><td>{s.nombre}</td><td>{s.vendidas}</td><td>{s.sobrante}</td></tr>)}</tbody></table>
        <p className="muted">Demanda insatisfecha ("agotado") requiere que el bot registre el evento; se añadirá con la Edge Function.</p></div>
    </div>
  )
}
