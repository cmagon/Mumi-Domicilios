import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { cop } from './hooks'
import type { Pedido } from './types'
import { PASOS, esEfectivo, estadoDePaso, fechaCorta, horaBonita, pasoDe } from './pedidoFlow'
import { AsyncButton, Confirmar, useToast } from './ui'
import { avisarCliente, EVENTO_PASO } from './avisarCliente'
import type { ComponentProps } from 'react'

type Conf = ComponentProps<typeof Confirmar>['c']

// Pedidos del cliente del chat: ver qué pidió, si pagó y avanzar el paso sin salir de la conversación
export default function PedidosCliente({ telefono, onCuenta }: { telefono: string; onCuenta?: (n: number) => void }) {
  const toast = useToast()
  const [lista, setLista] = useState<Pedido[]>([])
  const [conf, setConf] = useState<Conf>(null)

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('pedidos').select('*, pedido_items(cantidad, producto_id, productos(nombre))')
      .or(`chat_telefono.eq.${telefono},cliente_telefono.eq.${telefono}`).order('creado_en', { ascending: false }).limit(20)
    const l = (data ?? []) as unknown as Pedido[]
    setLista(l); onCuenta?.(l.filter((o) => !['entregado', 'cancelado'].includes(o.estado)).length)
  }, [telefono, onCuenta])
  useEffect(() => {
    cargar()
    const ch = supabase.channel(`pedidos-${telefono}`).on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => cargar()).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [telefono, cargar])

  const mover = async (o: Pedido, delta: 1 | -1) => {
    let nuevo = pasoDe(o.estado) + delta
    // Sin pago confirmado no se vuelve a "Confirmado" (la impresora lo reimprimiría): se regresa a Recibido
    if (delta === -1 && nuevo === 1 && !o.pagado && !esEfectivo(o)) nuevo = 0
    if (nuevo < 0 || nuevo >= PASOS.length) return false
    const cambios: Record<string, unknown> = { estado: estadoDePaso(nuevo, o) }
    if (nuevo === 1 && !esEfectivo(o)) cambios.pagado = true
    if (nuevo === 6) cambios.pagado = true
    const { error } = await supabase.from('pedidos').update(cambios).eq('id', o.id)
    if (error) { toast(error.message, 'err'); return false }
    toast(`Pedido #${o.numero} → ${PASOS[nuevo].label}`); cargar()
    if (delta === 1 && EVENTO_PASO[nuevo]) avisarCliente(o.id, nuevo === 1 && !esEfectivo(o) ? 'pago' : EVENTO_PASO[nuevo]).then((t) => t && toast(t, t.startsWith('Cliente') ? 'ok' : 'info'))
  }
  const avanzar = (o: Pedido) => {
    const p = pasoDe(o.estado)
    if (p === 0 && !esEfectivo(o) && !o.pagado) {
      setConf({ titulo: 'Confirmar pago', okText: 'Sí, pago recibido', texto: <>¿Ya verificaste el pago de <b>{cop(o.total)}</b>? Revisa el comprobante en el chat.</>, onOk: () => mover(o, 1) })
      return 'omitir'
    }
    if (p === 5 && !o.pagado) {
      setConf({ titulo: 'Entrega y cobro', okText: 'Entregado y pagado', texto: <>Confirma que se cobraron <b>{cop(o.total)}</b> ({o.metodo_pago ?? 'pago'}) al entregar.</>, onOk: () => mover(o, 1) })
      return 'omitir'
    }
    return mover(o, 1)
  }

  if (!lista.length) return <p className="muted" style={{ padding: 12 }}>Este cliente aún no tiene pedidos.</p>
  return (
    <div className="pedidos-cliente">
      {lista.map((o) => {
        const cancelado = o.estado === 'cancelado', paso = pasoDe(o.estado)
        return (
          <div className={`pc-card ${cancelado ? 'cancelado' : ''}`} key={o.id}>
            <div className="pc-cab"><b>#{o.numero}</b><span className="mini-badge">{cancelado ? 'Cancelado' : PASOS[paso].label}</span>
              {o.pendiente_produccion && <span className="mini-badge aviso">🍪 Por producir</span>}
              <span className="muted pc-fecha">{fechaCorta(o.fecha_entrega)}{o.hora_entrega_solicitada ? ` · ${horaBonita(o.hora_entrega_solicitada)}` : o.franja_horaria ? ` · ${o.franja_horaria}` : ''}</span></div>
            <div className="pc-pasos">{PASOS.map((p, i) => <span key={p.id} className={i <= paso && !cancelado ? 'hecho' : ''} />)}</div>
            <div>{(o.pedido_items ?? []).map((i) => `${i.cantidad} × ${i.productos?.nombre}`).join(' · ')}</div>
            <div className="muted">{cop(o.total)} · {o.metodo_pago ?? 'sin método'} · {o.pagado ? '✅ pagado' : esEfectivo(o) ? 'cobrar al entregar' : '⏳ sin pagar'} · {o.modalidad === 'domicilio' ? <>🛵 {o.direccion ?? ''}{o.lat != null && <> · <a href={`https://www.google.com/maps?q=${o.lat},${o.lng}`} target="_blank">Ver mapa</a></>}</> : 'Recoge en tienda'}</div>
            {o.nota && <div className="muted">📝 {o.nota}</div>}
            {!cancelado && paso < PASOS.length - 1 && <div className="pc-acc">
              {paso > 0 && <button className="ghost" onClick={() => mover(o, -1)}>← Atrás</button>}
              {!o.pagado && !esEfectivo(o) && paso === 0 && <button className="sec sm" onClick={() => setConf({ titulo: 'Imprimir con pago pendiente', okText: 'Imprimir igual', texto: <>El pago de <b>{cop(o.total)}</b> sigue pendiente; el ticket saldrá con la alerta «PAGO PENDIENTE».</>,
                onOk: async () => { const { error } = await supabase.from('pedidos').update({ estado: 'impreso', reimprimir: true }).eq('id', o.id); if (error) { toast(error.message, 'err'); return false } toast(`Ticket de #${o.numero} enviado a imprimir`); cargar() } })}>🖨 Imprimir (pago pendiente)</button>}
              <AsyncButton className="sig sm" okText="Hecho" onClick={() => avanzar(o)}>{PASOS[paso + 1].accion} →</AsyncButton></div>}
          </div>)
      })}
      <Confirmar c={conf} onClose={() => setConf(null)} />
    </div>
  )
}
