import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { cop } from '../hooks'

type C = { telefono: string; nombre: string; pedidos: number; total_gastado: number; ultimo_pedido: string; sabores_favoritos: string | null }
type Orden = 'pedidos' | 'total_gastado' | 'ultimo_pedido'

export default function Clientes() {
  const [rows, setRows] = useState<C[]>([])
  const [q, setQ] = useState('')
  const [orden, setOrden] = useState<Orden>('pedidos')

  useEffect(() => { supabase.from('clientes_resumen').select('*').then(({ data }) => setRows((data ?? []) as C[])) }, [])

  const lista = useMemo(() => rows
    .filter((c) => (c.nombre + c.telefono).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (orden === 'ultimo_pedido'
      ? +new Date(b.ultimo_pedido) - +new Date(a.ultimo_pedido) : Number(b[orden]) - Number(a[orden]))), [rows, q, orden])

  const exportar = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = ['Nombre,Teléfono,Pedidos,Total gastado,Último pedido,Sabores favoritos',
      ...lista.map((c) => [c.nombre, c.telefono, c.pedidos, c.total_gastado, c.ultimo_pedido?.slice(0, 10), c.sabores_favoritos].map(esc).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = 'clientes-mumi.csv'; a.click()
  }

  return (
    <>
      <div className="card"><div className="row">
        <input placeholder="Buscar por nombre o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={orden} onChange={(e) => setOrden(e.target.value as Orden)}>
          <option value="pedidos">Más pedidos</option><option value="total_gastado">Mayor gasto</option><option value="ultimo_pedido">Más recientes</option></select>
        <button className="sec" onClick={exportar}>Exportar CSV</button></div></div>
      {lista.map((c) => (
        <div className="card" key={c.telefono}>
          <div className="row"><b>{c.nombre}</b><span className="muted">{c.telefono}</span></div>
          <p>{c.pedidos} pedido{c.pedidos === 1 ? '' : 's'} · {cop(c.total_gastado)} · último {c.ultimo_pedido?.slice(0, 10)}</p>
          <p className="muted">Compra más: {c.sabores_favoritos ?? '—'}</p>
        </div>))}
      {!lista.length && <p className="muted">Aún no hay clientes con pedidos.</p>}
    </>
  )
}
