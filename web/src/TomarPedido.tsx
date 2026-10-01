import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { cop, hoy, useConfig } from './hooks'
import type { Producto } from './types'
import { AsyncButton, Modal, Switch, useToast } from './ui'
import { SelectorFecha, useCalendario } from './Calendario'
import { avisarCliente } from './avisarCliente'

type Item = { producto_id: string; cantidad: number }
const sin57 = (t: string) => t.replace(/\D/g, '').replace(/^57(?=\d{10}$)/, '')

// Toma el pedido de un chat (truncado o atendido por una persona): se prellena con lo que ya dijo el cliente, el admin completa y guarda,
// y se le avisa al cliente por WhatsApp que su pedido quedó tomado.
export default function TomarPedido({ telefono, nombre, abierto, onClose }: { telefono: string; nombre?: string | null; abierto: boolean; onClose: () => void }) {
  const toast = useToast()
  const { cfg } = useConfig()
  const cal = useCalendario()
  const [prods, setProds] = useState<Producto[]>([])
  const [metodos, setMetodos] = useState<{ nombre: string }[]>([])
  const [tarifas, setTarifas] = useState<{ nombre: string; valor: number }[]>([])
  const [f, setF] = useState({ nombre: '', tel: '', fecha: hoy(), hora: '', franja: '', modalidad: 'domicilio', direccion: '', zona: '', pago: '', pagado: false, nota: '', avisar: true })
  const [items, setItems] = useState<Item[]>([{ producto_id: '', cantidad: 1 }])
  const [geo, setGeo] = useState<{ lat: number | null; lng: number | null; aprox: boolean }>({ lat: null, lng: null, aprox: false })
  const [resumen, setResumen] = useState('')
  const [cargando, setCargando] = useState(false)
  const [err, setErr] = useState<Record<string, boolean>>({})
  const set = (k: string, v: string | boolean) => setF((x) => ({ ...x, [k]: v }))
  const franjas = (cfg.franjas_entrega ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  const efectivoOk = (cfg.acepta_efectivo ?? 'si') !== 'no'
  const opcionesPago = useMemo(() => [...(efectivoOk ? ['Efectivo'] : []), ...metodos.map((m) => m.nombre)], [efectivoOk, metodos])

  useEffect(() => {
    if (!abierto) return
    setErr({}); setResumen(''); setItems([{ producto_id: '', cantidad: 1 }])
    setF({ nombre: nombre ?? '', tel: sin57(telefono), fecha: cal.ajustar(hoy()), hora: '', franja: '', modalidad: 'domicilio', direccion: '', zona: '', pago: '', pagado: false, nota: '', avisar: true })
    ;(async () => {
      const [p, m, t, c] = await Promise.all([
        supabase.from('productos').select('*').eq('activo', true).order('nombre'),
        supabase.from('metodos_pago').select('nombre').eq('activo', true),
        supabase.from('tarifas_domicilio').select('nombre,valor').eq('activo', true),
        supabase.from('conversaciones').select('ultima_lat,ultima_lng,ultima_direccion_aprox').eq('telefono', telefono).maybeSingle(),
      ])
      const P = (p.data ?? []) as Producto[]
      setProds(P); setMetodos(m.data ?? []); setTarifas(t.data ?? [])
      if (c.data?.ultima_lat != null) { setGeo({ lat: c.data.ultima_lat, lng: c.data.ultima_lng, aprox: true }); setF((x) => ({ ...x, direccion: x.direccion || c.data!.ultima_direccion_aprox || '' })) } else setGeo({ lat: null, lng: null, aprox: false })
      // Prellenado con IA a partir de la conversación
      setCargando(true)
      const { data } = await supabase.functions.invoke('analizar-chats', { body: { modo: 'extraer_pedido', telefono } })
      setCargando(false)
      const e = data?.pedido as Record<string, any> | undefined
      if (!e) return
      const par = (n?: string) => P.find((x) => x.nombre.toLowerCase() === String(n ?? '').toLowerCase()) ?? P.find((x) => String(n ?? '').toLowerCase().includes(x.nombre.toLowerCase().split(' ')[0]))
      const its = (Array.isArray(e.items) ? e.items : []).map((i: any) => ({ producto_id: par(i.sabor)?.id ?? '', cantidad: Math.max(1, Math.round(Number(i.cantidad) || 1)) })).filter((i: Item) => i.producto_id)
      if (its.length) setItems(its)
      const tarifa = (t.data ?? []).find((x) => x.nombre.toLowerCase() === String(e.zona_tarifa ?? '').toLowerCase())
      setF((x) => ({
        ...x, nombre: e.nombre || x.nombre, tel: e.telefono_contacto ? sin57(String(e.telefono_contacto)) : x.tel,
        modalidad: e.modalidad === 'recoger' || e.modalidad === 'domicilio' ? e.modalidad : x.modalidad, direccion: e.direccion || x.direccion, zona: tarifa?.nombre ?? x.zona,
        pago: e.metodo_pago && (efectivoOk && /efectivo/i.test(e.metodo_pago) ? 'Efectivo' : (m.data ?? []).find((y) => y.nombre.toLowerCase() === String(e.metodo_pago).toLowerCase())?.nombre) || x.pago,
        fecha: e.fecha_entrega && e.fecha_entrega >= hoy() ? e.fecha_entrega : x.fecha, hora: e.hora_entrega ?? x.hora,
        franja: e.franja && franjas.includes(e.franja) ? e.franja : x.franja, nota: e.nota || x.nota,
      }))
      setResumen(String(e.resumen ?? ''))
    })()
  }, [abierto]) // eslint-disable-line

  const precio = (id: string) => prods.find((p) => p.id === id)?.precio ?? 0
  const tarifa = f.modalidad === 'domicilio' ? tarifas.find((t) => t.nombre === f.zona)?.valor ?? 0 : 0
  const subtotal = items.reduce((a, i) => a + precio(i.producto_id) * (i.cantidad || 0), 0)
  const total = subtotal + tarifa

  const guardar = async () => {
    const validos = items.filter((i) => i.producto_id && i.cantidad > 0)
    const e = { nombre: !f.nombre.trim(), tel: f.tel.replace(/\D/g, '').length < 7, items: !validos.length, direccion: false, pago: !f.pago, fecha: !f.fecha }
    setErr(e)
    if (Object.values(e).some(Boolean)) { toast('Revisa los campos marcados', 'err'); return false }
    const efectivo = /efectivo/i.test(f.pago)
    const sinDir = f.modalidad === 'domicilio' && !f.direccion.trim()
    const nota = [f.nota.trim(), sinDir ? '📞 LLAMAR al cliente para pedir la dirección/ubicación de entrega' : ''].filter(Boolean).join(' · ') || null
    const { data: ped, error } = await supabase.from('pedidos').insert({
      cliente_nombre: f.nombre.trim(), cliente_telefono: f.tel.trim(), chat_telefono: telefono, origen: 'manual', metodo_pago: f.pago,
      estado: efectivo ? 'pendiente_cobro' : f.pagado ? 'pago_verificado' : 'recibido', pagado: !efectivo && f.pagado, nota,
      fecha_entrega: f.fecha, hora_entrega_solicitada: f.hora || null, franja_horaria: f.franja || null, modalidad: f.modalidad,
      direccion: f.modalidad === 'domicilio' ? f.direccion.trim() || null : null, direccion_aprox: f.modalidad === 'domicilio' && geo.aprox && !!f.direccion.trim(),
      lat: f.modalidad === 'domicilio' ? geo.lat : null, lng: f.modalidad === 'domicilio' ? geo.lng : null, tarifa_domicilio: tarifa, total,
    }).select('id,numero').single()
    if (error || !ped) { toast(error?.message ?? 'No se pudo crear el pedido', 'err'); return false }
    const { error: e2 } = await supabase.from('pedido_items').insert(validos.map((i) => ({ ...i, pedido_id: ped.id, precio_unitario: precio(i.producto_id) })))
    if (e2) { toast(e2.message, 'err'); return false }
    await supabase.from('conversaciones').upsert({ telefono, esperando: null, esperando_desde: null, seguimientos: 0 }, { onConflict: 'telefono' }) // el bot ya no hace seguimiento de este chat
    toast(`Pedido #${ped.numero} creado`)
    if (f.avisar) { const t = await avisarCliente(ped.id, 'tomado'); if (t) toast(t, t.startsWith('Cliente') ? 'ok' : 'info') }
    setTimeout(onClose, 400)
  }

  return (
    <Modal abierto={abierto} titulo={`🛒 Tomar pedido · ${nombre ?? telefono}`} onClose={onClose} ancho={520}
      pie={<><button className="sec" onClick={onClose}>Cancelar</button><AsyncButton okText="Pedido creado" onClick={guardar}>Guardar pedido · {cop(total)}</AsyncButton></>}>
      {cargando ? <p className="muted">✨ Leyendo la conversación para rellenar el pedido…</p> : resumen && <p className="analisis-resumen">🧠 {resumen}</p>}
      <label>Cliente *</label><input className={err.nombre ? 'invalido' : ''} value={f.nombre} onChange={(e) => set('nombre', e.target.value)} />
      <label>Teléfono de contacto *</label><input className={err.tel ? 'invalido' : ''} inputMode="tel" value={f.tel} onChange={(e) => set('tel', e.target.value)} />
      <label>Sabores y cantidades *</label>
      {items.map((it, k) => (<div className="row" key={k}>
        <select className={err.items ? 'invalido' : ''} value={it.producto_id} onChange={(e) => setItems(items.map((x, j) => j === k ? { ...x, producto_id: e.target.value } : x))}>
          <option value="">— sabor —</option>{prods.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {cop(p.precio)}</option>)}</select>
        <input type="number" min={1} style={{ maxWidth: 80 }} value={it.cantidad} onChange={(e) => setItems(items.map((x, j) => j === k ? { ...x, cantidad: +e.target.value } : x))} />
        {items.length > 1 && <button className="sec sm" onClick={() => setItems(items.filter((_, j) => j !== k))} aria-label="Quitar">✕</button>}</div>))}
      <button type="button" className="sec sm" onClick={() => setItems([...items, { producto_id: '', cantidad: 1 }])}>+ otro sabor</button>
      <div className="row">
        <div><label>Fecha de entrega</label><SelectorFecha valor={f.fecha} onChange={(v) => set('fecha', v)} /></div>
        <div><label>Hora pedida</label><input type="time" value={f.hora} onChange={(e) => set('hora', e.target.value)} /></div>
      </div>
      {franjas.length > 0 && <><label>Franja</label><select value={f.franja} onChange={(e) => set('franja', e.target.value)}><option value="">— sin franja —</option>{franjas.map((x) => <option key={x}>{x}</option>)}</select></>}
      <label>Modalidad</label><select value={f.modalidad} onChange={(e) => set('modalidad', e.target.value)}><option value="domicilio">Domicilio</option><option value="recoger">Recoger</option></select>
      {f.modalidad === 'domicilio' && <>
        <label>Dirección {geo.aprox && <span className="muted">(aproximada por la ubicación compartida)</span>}</label>
        <input placeholder="Si aún no la sabes, déjala vacía: el pedido queda con la nota de llamar" value={f.direccion} onChange={(e) => set('direccion', e.target.value)} />
        {geo.lat != null && <p><a href={`https://www.google.com/maps?q=${geo.lat},${geo.lng}`} target="_blank">📍 Ver ubicación compartida</a></p>}
        <label>Tarifa de domicilio</label><select value={f.zona} onChange={(e) => set('zona', e.target.value)}><option value="">— sin tarifa —</option>{tarifas.map((t) => <option key={t.nombre} value={t.nombre}>{t.nombre} · {cop(t.valor)}</option>)}</select></>}
      <label>Método de pago *</label>
      <select className={err.pago ? 'invalido' : ''} value={f.pago} onChange={(e) => set('pago', e.target.value)}><option value="">— elegir —</option>{opcionesPago.map((m) => <option key={m}>{m}</option>)}</select>
      {f.pago && !/efectivo/i.test(f.pago) && <Switch checked={f.pagado} onChange={(v) => set('pagado', v)} label="El pago ya fue verificado" />}
      <label>Nota para el ticket</label><textarea style={{ minHeight: 60 }} value={f.nota} onChange={(e) => set('nota', e.target.value)} />
      <p className="muted">Subtotal {cop(subtotal)}{f.modalidad === 'domicilio' ? ` + domicilio ${cop(tarifa)}` : ''} = <b>{cop(total)}</b></p>
      <Switch checked={f.avisar} onChange={(v) => set('avisar', v)} label="Avisar al cliente por WhatsApp que su pedido ya se tomó" />
    </Modal>
  )
}
