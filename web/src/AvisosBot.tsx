import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { hoy } from './hooks'
import { AsyncButton, Modal, Switch, useToast } from './ui'

export type AvisoBot = { id: string; tipo: 'evento' | 'instruccion'; texto: string; fecha_desde: string | null; fecha_hasta: string | null; hora_desde: string | null; hora_hasta: string | null; bloquea_entregas: boolean; estado: string }
const vacio = { tipo: 'evento' as 'evento' | 'instruccion', texto: '', desde: '', hasta: '', hd: '', hh: '', bloquea: false }
const bonita = (f: string | null) => f ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }) : ''

export function useAvisosBot() {
  const [lista, setLista] = useState<AvisoBot[]>([])
  const cargar = useCallback(async () => {
    const { data } = await supabase.from('bot_avisos').select('*').eq('estado', 'activo').order('fecha_desde', { ascending: true, nullsFirst: true })
    setLista(((data ?? []) as AvisoBot[]).filter((a) => !a.fecha_hasta || a.fecha_hasta >= hoy()))
  }, [])
  useEffect(() => { cargar() }, [cargar])
  return { lista, recargar: cargar }
}

// Formulario para crear un aviso (evento o instrucción temporal). `fecha` precarga el día (desde el calendario).
export function AvisoModal({ abierto, fecha, onClose, onGuardado }: { abierto: boolean; fecha?: string | null; onClose: () => void; onGuardado: () => void }) {
  const toast = useToast()
  const [f, setF] = useState(vacio)
  useEffect(() => { if (abierto) setF({ ...vacio, desde: fecha ?? '', hasta: fecha ?? '' }) }, [abierto, fecha])
  const set = (k: string, v: string | boolean) => setF((x) => ({ ...x, [k]: v }))
  const guardar = async () => {
    if (f.texto.trim().length < 5) { toast('Escribe qué debe saber el bot', 'err'); return false }
    if (f.tipo === 'evento' && !f.desde) { toast('El evento necesita una fecha', 'err'); return false }
    if (f.hasta && f.desde && f.hasta < f.desde) { toast('La fecha final es anterior a la inicial', 'err'); return false }
    const { error } = await supabase.from('bot_avisos').insert({ tipo: f.tipo, texto: f.texto.trim(), fecha_desde: f.desde || null, fecha_hasta: f.hasta || f.desde || null,
      hora_desde: f.hd || null, hora_hasta: f.hh || null, bloquea_entregas: f.tipo === 'evento' && f.bloquea, estado: 'activo' })
    if (error) { toast(error.message, 'err'); return false }
    toast('Aviso guardado: el bot lo tendrá en cuenta'); onGuardado(); setTimeout(onClose, 400)
  }
  return (
    <Modal abierto={abierto} titulo="📣 Aviso temporal para el bot" onClose={onClose} ancho={460}
      pie={<><button className="sec" onClick={onClose}>Cancelar</button><AsyncButton okText="Guardado" onClick={guardar}>Guardar aviso</AsyncButton></>}>
      <label>Tipo</label>
      <select value={f.tipo} onChange={(e) => set('tipo', e.target.value)}><option value="evento">Evento (feria, mercado, descanso…)</option><option value="instruccion">Instrucción temporal</option></select>
      <label>{f.tipo === 'evento' ? 'Qué debe saber el bot (lugar, horario, qué pueden hacer los clientes)' : 'Instrucción para el bot'}</label>
      <textarea style={{ minHeight: 80 }} placeholder={f.tipo === 'evento' ? 'Estaremos en el mercado campesino del parque, de 8 a. m. a 2 p. m. Pueden pasar a comprar.' : 'Esta semana ofrece 10 % de descuento en la docena de Cacao'} value={f.texto} onChange={(e) => set('texto', e.target.value)} />
      <div className="row">
        <div><label>Desde {f.tipo === 'evento' ? '*' : '(opcional)'}</label><input type="date" min={hoy()} value={f.desde} onChange={(e) => set('desde', e.target.value)} /></div>
        <div><label>Hasta</label><input type="date" min={f.desde || hoy()} value={f.hasta} onChange={(e) => set('hasta', e.target.value)} /></div>
      </div>
      <div className="row">
        <div><label>Hora inicio</label><input type="time" value={f.hd} onChange={(e) => set('hd', e.target.value)} /></div>
        <div><label>Hora fin</label><input type="time" value={f.hh} onChange={(e) => set('hh', e.target.value)} /></div>
      </div>
      {f.tipo === 'evento' && <Switch checked={f.bloquea} onChange={(v) => set('bloquea', v)} label="Ese día NO hay entregas (el bot no agenda pedidos para esa fecha)" />}
      <p className="muted">Pasada la fecha (y la hora de fin), el bot deja de mencionarlo solo. {f.tipo === 'instruccion' && !f.hasta ? 'Sin fecha final queda vigente hasta que lo quites.' : ''}</p>
    </Modal>
  )
}

// Tarjeta de Configuración: avisos vigentes + crear/quitar
export default function AvisosBot() {
  const toast = useToast()
  const { lista, recargar } = useAvisosBot()
  const [nuevo, setNuevo] = useState(false)
  const quitar = async (a: AvisoBot) => {
    const { error } = await supabase.from('bot_avisos').update({ estado: 'quitado' }).eq('id', a.id)
    if (error) { toast(error.message, 'err'); return false }
    toast('Aviso retirado'); recargar()
  }
  return (
    <div className="card"><h2>📣 Avisos temporales del bot</h2>
      <p className="muted">Eventos o instrucciones con fecha. El bot los usa con los clientes y deja de mencionarlos al pasar la fecha. También puedes crearlos escribiéndole al bot desde tu WhatsApp de administrador: <b>"evento: …"</b> o <b>"instrucción: …"</b> (te pregunta lo que falte). Con <b>"avisos"</b> ves la lista y con <b>"quitar aviso 2"</b> lo retiras.</p>
      {lista.map((a) => (
        <div className="fila-item" key={a.id} style={{ padding: '8px 0', borderTop: '1px solid var(--bd)' }}>
          <div className="crece"><b>{a.tipo === 'evento' ? '🎪 Evento' : '📝 Instrucción'}</b>{a.fecha_desde && <> · {bonita(a.fecha_desde)}{a.fecha_hasta && a.fecha_hasta !== a.fecha_desde ? ` → ${bonita(a.fecha_hasta)}` : ''}{a.hora_desde ? ` · ${a.hora_desde.slice(0, 5)}${a.hora_hasta ? '–' + a.hora_hasta.slice(0, 5) : ''}` : ''}</>}
            {a.bloquea_entregas && <span className="badge rojo">sin entregas</span>}
            <div className="muted">{a.texto}</div></div>
          <button className="sec sm" onClick={() => quitar(a)} aria-label="Quitar">🗑</button>
        </div>))}
      {!lista.length && <p className="muted">No hay avisos vigentes.</p>}
      <div style={{ marginTop: 10 }}><button className="sec" onClick={() => setNuevo(true)}>+ Agregar aviso</button></div>
      <AvisoModal abierto={nuevo} onClose={() => setNuevo(false)} onGuardado={recargar} />
    </div>
  )
}
