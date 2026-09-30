import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { cop } from '../hooks'
import type { Pedido } from '../types'
import { imprimirTickets } from '../ticket'
import { AsyncButton, Confirmar, Modal, useToast, type Confirmacion } from '../ui'
import { PASOS, claveHora, esEfectivo, esUrgente, estadoDePaso, etiquetaFecha, horaBonita, minutoEntrega, pasoDe } from '../pedidoFlow'

type Filtro = 'activos' | 'entregados' | 'cancelados' | 'archivados'
const SELECT = '*, pedido_items(cantidad, producto_id, productos(nombre))'

export default function Pedidos() {
  const toast = useToast()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [filtro, setFiltro] = useState<Filtro>('activos')
  const [q, setQ] = useState('')
  const [comp, setComp] = useState<Record<string, string>>({})
  const [nuevos, setNuevos] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<Pedido | null>(null)
  const [conf, setConf] = useState<Confirmacion | null>(null)
  const primera = useRef(true)

  const load = useCallback(async () => {
    const { data } = await supabase.from('pedidos').select(SELECT)
      .order('fecha_entrega', { ascending: true, nullsFirst: false }).order('creado_en', { ascending: false }).limit(400)
    const lista = (data ?? []) as unknown as Pedido[]
    setPedidos(lista)
    setDetalle((d) => (d ? lista.find((x) => x.id === d.id) ?? null : d))
    const rutas = lista.map((o) => o.comprobante_url).filter(Boolean) as string[]
    if (rutas.length) {
      const { data: firmadas } = await supabase.storage.from('comprobantes').createSignedUrls(rutas, 3600)
      const porRuta = new Map((firmadas ?? []).map((f) => [f.path, f.signedUrl]))
      setComp(Object.fromEntries(lista.filter((o) => o.comprobante_url && porRuta.get(o.comprobante_url)).map((o) => [o.id, porRuta.get(o.comprobante_url!)!])))
    }
  }, [])

  useEffect(() => {
    load().then(() => { primera.current = false })
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
    const ch = supabase.channel('pedidos-vivo')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos' }, (p) => {
        load()
        setNuevos((s) => new Set(s).add(String(p.new.id)))
        setTimeout(() => setNuevos((s) => { const n = new Set(s); n.delete(String(p.new.id)); return n }), 8000)
        if ('Notification' in window && Notification.permission === 'granted')
          new Notification('Nuevo pedido Mumi', { body: `#${p.new.numero} · ${p.new.cliente_nombre}` })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos' }, () => load())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'pedidos' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  useEffect(() => {
    if (!menu) return
    const cerrar = () => setMenu(null)
    window.addEventListener('click', cerrar)
    return () => window.removeEventListener('click', cerrar)
  }, [menu])

  // ---------- Filtros y conteos ----------
  const pertenece = (o: Pedido, f: Filtro) =>
    f === 'archivados' ? !!o.archivado
      : o.archivado ? false
        : f === 'cancelados' ? o.estado === 'cancelado'
          : f === 'entregados' ? o.estado === 'entregado'
            : o.estado !== 'entregado' && o.estado !== 'cancelado'
  const conteo = useMemo(() => Object.fromEntries((['activos', 'entregados', 'cancelados', 'archivados'] as Filtro[]).map((f) => [f, pedidos.filter((o) => pertenece(o, f)).length])), [pedidos])

  const grupos = useMemo(() => {
    const txt = q.trim().toLowerCase()
    const vis = pedidos.filter((o) => pertenece(o, filtro) &&
      (!txt || `${o.numero} ${o.cliente_nombre} ${o.cliente_telefono} ${o.direccion ?? ''}`.toLowerCase().includes(txt)))
    const porFecha = new Map<string, Pedido[]>()
    vis.forEach((o) => { const k = o.fecha_entrega ?? 'sin'; porFecha.set(k, [...(porFecha.get(k) ?? []), o]) })
    const desc = filtro !== 'activos'
    return [...porFecha.entries()].sort(([a], [b]) => (a === 'sin' ? 1 : b === 'sin' ? -1 : desc ? b.localeCompare(a) : a.localeCompare(b)))
      .map(([fecha, lista]) => {
        // prioridad: hora pedida / franja más temprana primero; a igual hora, llegada más antigua primero
        const ord = [...lista].sort((x, y) => minutoEntrega(x) - minutoEntrega(y) || +new Date(x.creado_en) - +new Date(y.creado_en))
        const subs: { clave: string; etiqueta: string; items: Pedido[] }[] = []
        ord.forEach((o) => {
          const { clave, etiqueta } = claveHora(o)
          const ult = subs[subs.length - 1]
          if (ult && ult.clave === clave) ult.items.push(o); else subs.push({ clave, etiqueta, items: [o] })
        })
        return { fecha, total: lista.length, subs }
      })
  }, [pedidos, filtro, q])

  // ---------- Acciones ----------
  const actualizar = async (id: string, cambios: Record<string, unknown>) => {
    const { error } = await supabase.from('pedidos').update(cambios).eq('id', id)
    if (error) { toast(error.message, 'err'); return false }
    setPedidos((l) => l.map((o) => (o.id === id ? { ...o, ...cambios } as Pedido : o)))
    return true
  }
  const liberarStock = async (o: Pedido) => {
    if (!o.fecha_entrega || o.estado === 'cancelado' || o.estado === 'entregado') return
    for (const i of o.pedido_items ?? []) await supabase.rpc('liberar_stock', { p_fecha: o.fecha_entrega, p_producto: i.producto_id, p_cantidad: i.cantidad })
  }

  const mover = async (o: Pedido, delta: 1 | -1) => {
    const nuevo = pasoDe(o.estado) + delta
    if (nuevo < 0 || nuevo >= PASOS.length) return false
    const cambios: Record<string, unknown> = { estado: estadoDePaso(nuevo, o) }
    if (nuevo === 1 && !esEfectivo(o)) cambios.pagado = true
    if (nuevo === 6 && esEfectivo(o)) cambios.pagado = true
    const ok = await actualizar(o.id, cambios)
    if (ok) toast(`Pedido #${o.numero} → ${PASOS[nuevo].label}`)
    return ok
  }
  const avanzar = (o: Pedido) => {
    const p = pasoDe(o.estado)
    if (p === 0 && !esEfectivo(o) && !o.pagado) {
      setConf({ titulo: 'Confirmar pago', okText: 'Sí, pago recibido', texto: <>¿Ya verificaste el pago de <b>{cop(o.total)}</b> de {o.cliente_nombre}?{comp[o.id] && <> Revisa el soporte adjunto.</>}</>, onOk: () => mover(o, 1) })
      return 'omitir'
    }
    if (p === 5 && esEfectivo(o) && !o.pagado) {
      setConf({ titulo: 'Entrega y cobro', okText: 'Entregado y cobrado', texto: <>Marca como entregado y confirma que se cobraron <b>{cop(o.total)}</b> en efectivo.</>, onOk: () => mover(o, 1) })
      return 'omitir'
    }
    return mover(o, 1)
  }

  const reimprimir = async (o: Pedido) => { if (await actualizar(o.id, { reimprimir: true })) toast(`Reimpresión de #${o.numero} enviada a la impresora`) }
  const archivar = async (o: Pedido, v: boolean) => { if (await actualizar(o.id, { archivado: v })) toast(v ? `Pedido #${o.numero} archivado` : `Pedido #${o.numero} restaurado`) }
  const cancelar = (o: Pedido) => setConf({
    titulo: `Cancelar pedido #${o.numero}`, peligro: true, okText: 'Cancelar pedido',
    texto: <>Se libera el stock reservado. El pedido pasa a <b>Cancelados</b> y puedes archivarlo o eliminarlo después.</>,
    onOk: async () => { await liberarStock(o); return actualizar(o.id, { estado: 'cancelado' }) },
  })
  const eliminar = (o: Pedido) => setConf({
    titulo: `Eliminar pedido #${o.numero}`, peligro: true, okText: 'Eliminar definitivamente',
    texto: <>Se borra <b>definitivamente</b> el pedido de {o.cliente_nombre} ({cop(o.total)}) y su historial. {o.estado !== 'cancelado' && o.estado !== 'entregado' && 'Se libera también el stock reservado. '}Esta acción no se puede deshacer. Si solo quieres ocultarlo, usa <b>Archivar</b>.</>,
    onOk: async () => {
      await liberarStock(o)
      const { error } = await supabase.from('pedidos').delete().eq('id', o.id)
      if (error) { toast(error.message, 'err'); return false }
      setPedidos((l) => l.filter((x) => x.id !== o.id)); setDetalle(null); toast(`Pedido #${o.numero} eliminado`)
    },
  })

  return (
    <>
      <div className="card">
        <div className="chips">
          {([['activos', 'Activos'], ['entregados', 'Entregados'], ['cancelados', 'Cancelados'], ['archivados', 'Archivados']] as [Filtro, string][]).map(([f, l]) => (
            <button key={f} className={`chip ${filtro === f ? 'on' : ''}`} onClick={() => setFiltro(f)}>{l}<b>{conteo[f] ?? 0}</b></button>))}
        </div>
        <input style={{ marginTop: 8 }} placeholder="Buscar por #, nombre, teléfono o dirección" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {grupos.map((g) => (
        <section key={g.fecha}>
          <div className="grupo-fecha"><h3>{etiquetaFecha(g.fecha === 'sin' ? null : g.fecha)}</h3><span className="muted">{g.total} pedido{g.total === 1 ? '' : 's'}</span></div>
          {g.subs.map((s) => (
            <div key={s.clave}>
              <div className="sub-hora">{s.etiqueta}</div>
              {s.items.map((o) => {
                const paso = pasoDe(o.estado)
                const cancelado = o.estado === 'cancelado'
                const listo = paso >= PASOS.length - 1
                return (
                  <div key={o.id} className={`card pedido ${esUrgente(o) ? 'urgente' : ''} ${o.hora_entrega_solicitada ? 'hora' : ''} ${nuevos.has(o.id) ? 'nuevo' : ''} ${cancelado ? 'cancelado' : ''}`}>
                    <div className="cab-pedido">
                      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                        <b>#{o.numero} · {o.cliente_nombre}</b>{' '}
                        {o.origen === 'manual' && <span className="badge">manual</span>}{' '}
                        {o.hora_entrega_solicitada && <span className={`badge hora-pedida ${esUrgente(o) ? 'rojo' : ''}`}>🕒 {horaBonita(o.hora_entrega_solicitada)}</span>}
                        {esUrgente(o) && <span className="badge rojo">¡pronto!</span>}
                      </div>
                      <div style={{ flex: 'none', position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                        <button className="sec sm" onClick={() => setMenu(menu === o.id ? null : o.id)} aria-label="Más opciones">⋯</button>
                        {menu === o.id && (
                          <div className="menu-pop">
                            <button onClick={() => { setDetalle(o); setMenu(null) }}>Ver detalle / editar</button>
                            <button onClick={() => { reimprimir(o); setMenu(null) }}>Reimprimir ticket</button>
                            <button onClick={() => { imprimirTickets([o]); setMenu(null) }}>Imprimir desde el navegador</button>
                            {o.archivado ? <button onClick={() => { archivar(o, false); setMenu(null) }}>Sacar de archivados</button>
                              : <button onClick={() => { archivar(o, true); setMenu(null) }}>Archivar</button>}
                            {!cancelado && o.estado !== 'entregado' && <button className="rojo" onClick={() => { cancelar(o); setMenu(null) }}>Cancelar pedido</button>}
                            <button className="rojo" onClick={() => { eliminar(o); setMenu(null) }}>Eliminar</button>
                          </div>)}
                      </div>
                    </div>
                    <p style={{ margin: '6px 0 2px' }}>{(o.pedido_items ?? []).map((i) => `${i.cantidad} ${i.productos?.nombre}`).join(' · ')}</p>
                    <p className="muted" style={{ margin: 0 }}>
                      {cop(o.total)} · {o.metodo_pago ?? 'sin método'} · {o.pagado ? <span style={{ color: '#1e7d32' }}>pagado</span> : esEfectivo(o) ? 'cobrar al entregar' : <span style={{ color: '#b00020' }}>sin pagar</span>}
                      {' · '}{o.modalidad === 'domicilio' ? `📍 ${o.direccion ?? ''}${o.direccion_aprox ? ' (aprox.)' : ''}` : 'Recoge en punto'}
                    </p>
                    {o.nota && <p style={{ margin: '4px 0 0' }}><b>Nota:</b> {o.nota}</p>}
                    {!cancelado && (
                      <div className="stepper" aria-label="Progreso del pedido">
                        <div className="barra" style={{ width: `${(paso / (PASOS.length - 1)) * 100}%` }} />
                        {PASOS.map((p, i) => <div key={p.id} className={`paso ${i < paso ? 'hecho' : ''} ${i === paso ? 'actual' : ''}`}><i /><span>{p.label}</span></div>)}
                      </div>)}
                    <div className="acciones">
                      {cancelado
                        ? <span className="badge rojo">Cancelado</span>
                        : <>
                          {paso > 0 && !listo && <AsyncButton className="sec" okText="" onClick={() => mover(o, -1)}>← Atrás</AsyncButton>}
                          {!listo
                            ? <AsyncButton className="sig" okText="Hecho" onClick={() => avanzar(o)}>{PASOS[paso + 1].accion} →</AsyncButton>
                            : <span className="badge ok">✓ Entregado</span>}
                          {listo && <button className="sec sm" onClick={() => archivar(o, !o.archivado)}>{o.archivado ? 'Sacar de archivados' : 'Archivar'}</button>}
                        </>}
                      {comp[o.id] && <button className="sec sm" onClick={() => setDetalle(o)}>🧾 Soporte</button>}
                    </div>
                  </div>)
              })}
            </div>))}
        </section>))}
      {!grupos.length && <p className="muted" style={{ textAlign: 'center', padding: 24 }}>No hay pedidos en esta vista.</p>}

      <DetallePedido pedido={detalle} comprobante={detalle ? comp[detalle.id] : undefined} onClose={() => setDetalle(null)}
        onGuardar={async (id, c) => { const ok = await actualizar(id, c); if (ok) toast('Pedido actualizado'); return ok }}
        onEliminar={eliminar} onCancelar={cancelar} />
      <Confirmar c={conf} onClose={() => setConf(null)} />
    </>
  )
}

function DetallePedido({ pedido: o, comprobante, onClose, onGuardar, onEliminar, onCancelar }: {
  pedido: Pedido | null; comprobante?: string; onClose: () => void
  onGuardar: (id: string, c: Record<string, unknown>) => Promise<boolean>; onEliminar: (o: Pedido) => void; onCancelar: (o: Pedido) => void
}) {
  const [f, setF] = useState({ hora: '', franja: '', nota: '', direccion: '', fecha: '' })
  const idCargado = useRef<string | null>(null)
  useEffect(() => {
    if (o && idCargado.current !== o.id) {
      idCargado.current = o.id
      setF({ hora: o.hora_entrega_solicitada?.slice(0, 5) ?? '', franja: o.franja_horaria ?? '', nota: o.nota ?? '', direccion: o.direccion ?? '', fecha: o.fecha_entrega ?? '' })
    }
    if (!o) idCargado.current = null
  }, [o])
  if (!o) return <Modal abierto={false} titulo="" onClose={onClose}>{null}</Modal>
  const editable = pasoDe(o.estado) < 2 && o.estado !== 'cancelado'
  return (
    <Modal abierto titulo={`Pedido #${o.numero} · ${o.cliente_nombre}`} onClose={onClose} ancho={560}
      pie={<>
        {o.estado !== 'cancelado' && o.estado !== 'entregado' && <button className="sec" onClick={() => onCancelar(o)}>Cancelar pedido</button>}
        <button className="peligro" onClick={() => onEliminar(o)}>Eliminar</button>
        <AsyncButton okText="Guardado" onClick={() => onGuardar(o.id, { hora_entrega_solicitada: f.hora || null, franja_horaria: f.franja || null, nota: f.nota || null, direccion: f.direccion || null, fecha_entrega: f.fecha || null })}>Guardar cambios</AsyncButton>
      </>}>
      <p className="muted">Tel {o.cliente_telefono}{o.chat_telefono ? ` · chat ${o.chat_telefono}` : ''} · {o.origen === 'bot' ? 'pedido del bot' : 'pedido manual'}</p>
      <p>{(o.pedido_items ?? []).map((i) => `${i.cantidad} × ${i.productos?.nombre}`).join(' · ')} — <b>{cop(o.total)}</b> ({o.metodo_pago}, {o.pagado ? 'pagado' : 'sin pagar'})</p>
      {!editable && <p className="muted">El ticket ya se imprimió: puedes ajustar hora, nota y dirección, pero reimprime el ticket para que salga actualizado.</p>}
      <div className="row">
        <div><label>Fecha de entrega</label><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></div>
        <div><label>Hora pedida por el cliente</label><input type="time" value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} /></div>
      </div>
      <label>Franja horaria</label><input placeholder="ej. 14:00-16:00" value={f.franja} onChange={(e) => setF({ ...f, franja: e.target.value })} />
      <label>Dirección{o.direccion_aprox ? ' (aproximada, por ubicación compartida)' : ''}</label>
      <input value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} />
      {o.lat != null && <p><a href={`https://www.google.com/maps?q=${o.lat},${o.lng}`} target="_blank">📍 Ver ubicación en el mapa</a></p>}
      <label>Nota</label><textarea style={{ minHeight: 70 }} value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} />
      <label>Soporte de pago</label>
      {comprobante ? <a href={comprobante} target="_blank"><img src={comprobante} alt="comprobante" style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 8, border: '1px solid var(--bd)' }} /></a>
        : <p className="muted">Sin soporte adjunto.</p>}
    </Modal>
  )
}
