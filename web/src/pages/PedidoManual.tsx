import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { hoy, useConfig } from '../hooks'
import type { Producto } from '../types'
import { AsyncButton, useToast } from '../ui'
import HoraPicker from '../HoraPicker'
import { SelectorFecha, useCalendario } from '../Calendario'

export default function PedidoManual() {
  const toast = useToast()
  const { cfg } = useConfig()
  const [prods, setProds] = useState<Producto[]>([])
  const [metodos, setMetodos] = useState<{ nombre: string }[]>([])
  const [f, setF] = useState({ nombre: '', tel: '', pago: '', nota: '', fecha: hoy(), hora: '', franja: '', modalidad: 'domicilio', direccion: '', tarifa: '0' })
  const [items, setItems] = useState<{ producto_id: string; cantidad: number }[]>([{ producto_id: '', cantidad: 1 }])
  const cal = useCalendario()
  useEffect(() => { if (!cal.cargando) setF((x) => ({ ...x, fecha: cal.ajustar(x.fecha) })) }, [cal.cargando, cal.ajustar]) // eslint-disable-line
  const [err, setErr] = useState<Record<string, boolean>>({})
  useEffect(() => {
    supabase.from('productos').select('*').eq('activo', true).order('nombre').then(({ data }) => setProds(data ?? []))
    supabase.from('metodos_pago').select('nombre').eq('activo', true).then(({ data }) => setMetodos(data ?? []))
  }, [])
  const set = (k: string, v: string) => setF({ ...f, [k]: v })
  const efectivoOk = (cfg.acepta_efectivo ?? 'si') !== 'no'
  const opcionesPago = [...(efectivoOk ? ['Efectivo'] : []), ...metodos.map((m) => m.nombre)]
  useEffect(() => { if (!f.pago && opcionesPago.length) setF((x) => ({ ...x, pago: opcionesPago[0] })) }, [opcionesPago.length]) // eslint-disable-line

  const guardar = async () => {
    const validos = items.filter((i) => i.producto_id && i.cantidad > 0)
    const e = { nombre: !f.nombre.trim(), tel: !f.tel.trim(), items: !validos.length, direccion: f.modalidad === 'domicilio' && !f.direccion.trim(), pago: !f.pago }
    setErr(e)
    if (Object.values(e).some(Boolean)) { toast('Revisa los campos marcados', 'err'); return false }
    const precio = (id: string) => prods.find((p) => p.id === id)?.precio ?? 0
    const total = validos.reduce((a, i) => a + precio(i.producto_id) * i.cantidad, 0) + (+f.tarifa || 0)
    const efectivo = f.pago.toLowerCase().includes('efectivo')
    const { data: ped, error } = await supabase.from('pedidos').insert({
      cliente_nombre: f.nombre.trim(), cliente_telefono: f.tel.trim(), origen: 'manual', metodo_pago: f.pago,
      estado: efectivo ? 'pendiente_cobro' : 'recibido', pagado: false, nota: f.nota || null,
      fecha_entrega: f.fecha, hora_entrega_solicitada: f.hora || null, franja_horaria: f.franja || null, modalidad: f.modalidad,
      direccion: f.direccion || null, tarifa_domicilio: +f.tarifa || 0, total,
    }).select('id,numero').single()
    if (error || !ped) { toast(error?.message ?? 'No se pudo crear el pedido', 'err'); return false }
    const { error: e2 } = await supabase.from('pedido_items').insert(validos.map((i) => ({ ...i, pedido_id: ped.id, precio_unitario: precio(i.producto_id) })))
    if (e2) { toast(e2.message, 'err'); return false }
    toast(`Pedido #${ped.numero} creado`)
    setItems([{ producto_id: '', cantidad: 1 }]); setF({ ...f, nombre: '', tel: '', nota: '', direccion: '', hora: '' }); setErr({})
  }

  return (
    <div className="card"><h2>Pedido manual</h2>
      <label>Cliente *</label><input className={err.nombre ? 'invalido' : ''} value={f.nombre} onChange={(e) => set('nombre', e.target.value)} />
      <label>Teléfono *</label><input className={err.tel ? 'invalido' : ''} inputMode="tel" value={f.tel} onChange={(e) => set('tel', e.target.value)} />
      <label>Sabores y cantidades *</label>
      {items.map((it, k) => (<div className="row" key={k}>
        <select className={err.items ? 'invalido' : ''} value={it.producto_id} onChange={(e) => setItems(items.map((x, j) => j === k ? { ...x, producto_id: e.target.value } : x))}>
          <option value="">— sabor —</option>{prods.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
        <input type="number" min={1} value={it.cantidad} onChange={(e) => setItems(items.map((x, j) => j === k ? { ...x, cantidad: +e.target.value } : x))} />
        {items.length > 1 && <button className="sec sm" onClick={() => setItems(items.filter((_, j) => j !== k))} aria-label="Quitar">✕</button>}</div>))}
      <button type="button" className="sec sm" onClick={() => setItems([...items, { producto_id: '', cantidad: 1 }])}>+ otro sabor</button>
      <div className="row">
        <div><label>Fecha de entrega</label><SelectorFecha valor={f.fecha} onChange={(v) => set('fecha', v)} /></div>
        <div><label>Hora pedida (opcional)</label><HoraPicker valor={f.hora} onChange={(v) => set('hora', v)} placeholder="Sin hora" /></div>
      </div>
      <label>Franja horaria</label><input placeholder="ej. 14:00-16:00" value={f.franja} onChange={(e) => set('franja', e.target.value)} />
      <label>Modalidad</label><select value={f.modalidad} onChange={(e) => set('modalidad', e.target.value)}><option value="domicilio">Domicilio</option><option value="recoger">Recoger</option></select>
      {f.modalidad === 'domicilio' && <><label>Dirección *</label><input className={err.direccion ? 'invalido' : ''} value={f.direccion} onChange={(e) => set('direccion', e.target.value)} />
        <label>Tarifa domicilio</label><input type="number" value={f.tarifa} onChange={(e) => set('tarifa', e.target.value)} /></>}
      <label>Método de pago *</label>
      <select className={err.pago ? 'invalido' : ''} value={f.pago} onChange={(e) => set('pago', e.target.value)}>
        {opcionesPago.map((m) => <option key={m}>{m}</option>)}</select>
      <label>Nota (ej. sin azúcar, evento 30 personas)</label><textarea style={{ minHeight: 70 }} value={f.nota} onChange={(e) => set('nota', e.target.value)} />
      <div style={{ marginTop: 12 }}><AsyncButton okText="Pedido creado" onClick={guardar}>Crear pedido</AsyncButton></div>
    </div>
  )
}
