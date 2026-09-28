import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { hoy } from '../hooks'
import type { Producto } from '../types'

export default function PedidoManual() {
  const [prods, setProds] = useState<Producto[]>([])
  const [metodos, setMetodos] = useState<{ nombre: string }[]>([])
  const [f, setF] = useState({ nombre: '', tel: '', pago: 'Efectivo', nota: '', fecha: hoy(), franja: '', modalidad: 'domicilio', direccion: '', tarifa: '0' })
  const [items, setItems] = useState<{ producto_id: string; cantidad: number }[]>([{ producto_id: '', cantidad: 1 }])
  const [msg, setMsg] = useState('')
  useEffect(() => {
    supabase.from('productos').select('*').eq('activo', true).then(({ data }) => setProds(data ?? []))
    supabase.from('metodos_pago').select('nombre').then(({ data }) => setMetodos(data ?? []))
  }, [])
  const set = (k: string, v: string) => setF({ ...f, [k]: v })

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg('')
    const validos = items.filter((i) => i.producto_id && i.cantidad > 0)
    if (!validos.length) return setMsg('Agrega al menos un sabor')
    const precio = (id: string) => prods.find((p) => p.id === id)?.precio ?? 0
    const total = validos.reduce((a, i) => a + precio(i.producto_id) * i.cantidad, 0) + (+f.tarifa || 0)
    const efectivo = f.pago.toLowerCase().includes('efectivo')
    const { data: ped, error } = await supabase.from('pedidos').insert({
      cliente_nombre: f.nombre, cliente_telefono: f.tel, origen: 'manual', metodo_pago: f.pago,
      estado: efectivo ? 'pendiente_cobro' : 'recibido', pagado: false, nota: f.nota || null,
      fecha_entrega: f.fecha, franja_horaria: f.franja || null, modalidad: f.modalidad,
      direccion: f.direccion || null, tarifa_domicilio: +f.tarifa || 0, total,
    }).select('id').single()
    if (error || !ped) return setMsg(error?.message ?? 'Error')
    const { error: e2 } = await supabase.from('pedido_items').insert(
      validos.map((i) => ({ ...i, pedido_id: ped.id, precio_unitario: precio(i.producto_id) })))
    if (e2) return setMsg(e2.message)
    // Descuenta del excedente del día de entrega, sin bajar de 0
    for (const i of validos) {
      const { data: s } = await supabase.from('stock_dia').select('*').eq('fecha', f.fecha).eq('producto_id', i.producto_id).maybeSingle()
      if (s) await supabase.from('stock_dia').update({ cantidad_agendada: s.cantidad_agendada + i.cantidad }).eq('id', s.id)
      else await supabase.from('stock_dia').insert({ fecha: f.fecha, producto_id: i.producto_id, cantidad_agendada: i.cantidad })
    }
    setMsg('Pedido creado'); setItems([{ producto_id: '', cantidad: 1 }]); setF({ ...f, nombre: '', tel: '', nota: '', direccion: '' })
  }

  return (
    <form className="card" onSubmit={guardar}><h2>Pedido manual</h2>
      <label>Cliente</label><input required value={f.nombre} onChange={(e) => set('nombre', e.target.value)} />
      <label>Teléfono</label><input required value={f.tel} onChange={(e) => set('tel', e.target.value)} />
      <label>Sabores y cantidades</label>
      {items.map((it, k) => (<div className="row" key={k}>
        <select value={it.producto_id} onChange={(e) => setItems(items.map((x, j) => j === k ? { ...x, producto_id: e.target.value } : x))}>
          <option value="">— sabor —</option>{prods.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
        <input type="number" min={1} value={it.cantidad} onChange={(e) => setItems(items.map((x, j) => j === k ? { ...x, cantidad: +e.target.value } : x))} /></div>))}
      <button type="button" className="sec sm" onClick={() => setItems([...items, { producto_id: '', cantidad: 1 }])}>+ otro sabor</button>
      <label>Fecha de entrega</label><input type="date" value={f.fecha} onChange={(e) => set('fecha', e.target.value)} />
      <label>Franja horaria</label><input value={f.franja} onChange={(e) => set('franja', e.target.value)} />
      <label>Modalidad</label><select value={f.modalidad} onChange={(e) => set('modalidad', e.target.value)}><option value="domicilio">Domicilio</option><option value="recoger">Recoger</option></select>
      {f.modalidad === 'domicilio' && <><label>Dirección</label><input value={f.direccion} onChange={(e) => set('direccion', e.target.value)} />
        <label>Tarifa domicilio</label><input type="number" value={f.tarifa} onChange={(e) => set('tarifa', e.target.value)} /></>}
      <label>Método de pago</label>
      <select value={f.pago} onChange={(e) => set('pago', e.target.value)}>
        <option>Efectivo</option>{metodos.map((m) => <option key={m.nombre}>{m.nombre}</option>)}</select>
      <label>Nota (ej. sin azúcar, evento 30 personas)</label><textarea style={{ minHeight: 70 }} value={f.nota} onChange={(e) => set('nota', e.target.value)} />
      <p className="err">{msg}</p><button type="submit">Crear pedido</button>
    </form>
  )
}
