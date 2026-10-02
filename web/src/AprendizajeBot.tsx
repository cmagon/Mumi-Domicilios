import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { AsyncButton, Confirmar, Switch, useToast, type Confirmacion } from './ui'
import { useConfig } from './hooks'

type Regla = { id: string; regla: string; evidencia: string | null; origen_telefono: string | null; estado: 'pendiente' | 'activa' | 'descartada' | 'integrada'; creado_en: string; decidido_en?: string | null; vigente_hasta?: string | null; categoria?: string | null }
const CAT: Record<string, string> = { estilo: '🗣 Estilo del equipo', conocimiento: '💡 Dato del equipo', politica: '⚖️ Criterio del equipo' }
const fecha = (iso?: string | null) => (iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
type Respaldo = { id: string; creado_en: string; automatico: boolean; nota: string | null; config: Record<string, string>; aprendizajes: unknown[] }

// Aprendizaje continuo (reglas que la IA propone a partir de las conversaciones) y respaldos del bot (prompt + modelo + reglas)
export default function AprendizajeBot({ parte, onPromptActualizado }: { parte?: 'reglas' | 'respaldos'; onPromptActualizado?: () => void }) {
  const toast = useToast()
  const { cfg, save } = useConfig()
  const auto = cfg.aprendizaje_auto === 'si'
  const [reglas, setReglas] = useState<Regla[]>([])
  const [resp, setResp] = useState<Respaldo[]>([])
  const [nueva, setNueva] = useState('')
  const [edit, setEdit] = useState<{ id: string; texto: string; hasta: string } | null>(null)
  const [nuevaHasta, setNuevaHasta] = useState('')
  const [conf, setConf] = useState<Confirmacion | null>(null)

  const cargar = useCallback(async () => {
    const [r, b] = await Promise.all([
      supabase.from('bot_aprendizajes').select('*').neq('estado', 'descartada').order('creado_en', { ascending: false }).limit(100),
      supabase.from('bot_respaldos').select('*').order('creado_en', { ascending: false }).limit(15),
    ])
    setReglas((r.data ?? []) as Regla[]); setResp((b.data ?? []) as Respaldo[])
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const decidir = async (x: Regla, estado: 'activa' | 'descartada') => {
    const { error } = await supabase.from('bot_aprendizajes').update({ estado, decidido_en: new Date().toISOString() }).eq('id', x.id)
    if (error) { toast(error.message, 'err'); return false }
    toast(estado === 'activa' ? 'Regla activada: el bot la aplica desde el próximo mensaje' : 'Regla descartada'); cargar()
  }
  const guardarEdicion = async () => {
    if (!edit || edit.texto.trim().length < 10) { toast('Escribe la regla completa', 'err'); return false }
    const { error } = await supabase.from('bot_aprendizajes').update({ regla: edit.texto.trim(), vigente_hasta: edit.hasta || null }).eq('id', edit.id)
    if (error) { toast(error.message, 'err'); return false }
    setEdit(null); cargar()
  }
  const agregar = async () => {
    if (nueva.trim().length < 10) { toast('Escribe la regla completa (mín. 10 letras)', 'err'); return false }
    const { error } = await supabase.from('bot_aprendizajes').insert({ regla: nueva.trim(), estado: 'activa', decidido_en: new Date().toISOString(), vigente_hasta: nuevaHasta || null })
    if (error) { toast(error.message, 'err'); return false }
    setNueva(''); setNuevaHasta(''); toast('Regla agregada y activa'); cargar()
  }
  const integrar = (x: Regla) => setConf({
    titulo: 'Agregar al prompt maestro', okText: 'Agregar al prompt',
    texto: <>Se agregará esta regla al <b>final del prompt maestro</b> (sección "Aprendizajes integrados") y el prompt se actualizará. Antes se guarda un <b>respaldo</b> automático del prompt actual, que puedes restaurar en Respaldos.<div className="regla" style={{ marginTop: 8 }}>{x.regla}</div></>,
    onOk: async () => {
      const { error } = await supabase.rpc('integrar_regla', { p_id: x.id })
      if (error) { toast(error.message, 'err'); return false }
      toast('Regla integrada al prompt maestro (respaldo guardado)'); cargar(); onPromptActualizado?.()
    },
  })
  const revisar = async () => {
    const { data, error } = await supabase.functions.invoke('analizar-chats', { body: { modo: 'aprender', limite: 5 } })
    if (error || !data?.ok) { toast(data?.error ?? error?.message ?? 'No se pudo revisar', 'err'); return false }
    toast(data.revisadas ? `${data.revisadas} conversación(es) revisada(s), ${data.reglas} regla(s) nueva(s)` : 'No hay conversaciones nuevas por revisar', 'info'); cargar()
  }
  const aprenderEquipo = async () => {
    const { data, error } = await supabase.functions.invoke('analizar-chats', { body: { modo: 'equipo', limite: 5 } })
    if (error || !data?.ok) { toast(data?.error ?? error?.message ?? 'No se pudo revisar', 'err'); return false }
    toast(data.revisadas ? `${data.revisadas} conversación(es) con tu intervención revisada(s), ${data.reglas} sugerencia(s) nueva(s)` : 'No hay conversaciones nuevas donde hayas respondido', 'info'); cargar()
  }
  const respaldar = async () => {
    const { error } = await supabase.rpc('crear_respaldo', { p_nota: 'Respaldo manual' })
    if (error) { toast(error.message, 'err'); return false }
    toast('Respaldo creado'); cargar()
  }
  const restaurar = (b: Respaldo) => setConf({
    titulo: 'Restaurar respaldo', okText: 'Restaurar', peligro: true,
    texto: <>Se restaurarán el prompt, el modelo y toda la configuración del <b>{new Date(b.creado_en).toLocaleString('es-CO')}</b> y las reglas de aprendizaje de ese momento. Antes se guarda un respaldo del estado actual.</>,
    onOk: async () => {
      const { error } = await supabase.rpc('restaurar_respaldo', { p_id: b.id })
      if (error) { toast(error.message, 'err'); return false }
      toast('Respaldo restaurado; recargando…'); setTimeout(() => window.location.reload(), 900)
    },
  })
  const descargar = (b: Respaldo) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `respaldo-bot-${b.creado_en.slice(0, 16).replace(/[:T]/g, '-')}.json`; a.click(); URL.revokeObjectURL(url)
  }

  const pendientes = reglas.filter((r) => r.estado === 'pendiente'), activas = reglas.filter((r) => r.estado === 'activa'), integradas = reglas.filter((r) => r.estado === 'integrada')
  // Agrupadas por fecha (minimizadas): una sección plegable por día
  const porFecha = (l: Regla[]) => {
    const m = new Map<string, Regla[]>()
    l.forEach((r) => { const k = r.creado_en.slice(0, 10); m.set(k, [...(m.get(k) ?? []), r]) })
    return [...m.entries()].sort(([a], [b]) => b.localeCompare(a))
  }
  const Grupos = ({ l, abiertoPrimero }: { l: Regla[]; abiertoPrimero?: boolean }) => (
    <>{porFecha(l).map(([dia, rs], i) => (
      <details className="grupo-reglas" key={dia} open={abiertoPrimero && i === 0 && false}>
        <summary>📅 {new Date(dia + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })} <b>{rs.length}</b></summary>
        {rs.map((x) => <Fila key={x.id} x={x} />)}
      </details>))}</>
  )
  const Fila = ({ x }: { x: Regla }) => (
    <div className="regla">
      {edit?.id === x.id
        ? <><textarea style={{ minHeight: 60 }} value={edit.texto} onChange={(e) => setEdit({ ...edit, texto: e.target.value })} />
          <label>Vigente hasta (opcional: pasada esa fecha el bot deja de aplicarla)</label><input type="date" value={edit.hasta} onChange={(e) => setEdit({ ...edit, hasta: e.target.value })} />
          <div className="row"><AsyncButton okText="Guardada" onClick={guardarEdicion}>Guardar</AsyncButton><button className="sec" onClick={() => setEdit(null)}>Cancelar</button></div></>
        : <><div>{x.categoria && CAT[x.categoria] && <span className="badge" style={{ marginRight: 6 }}>{CAT[x.categoria]}</span>}{x.regla}</div>
          {x.evidencia && <div className="muted">Fricción detectada: {x.evidencia}</div>}
          <div className="muted">📅 Propuesta el {fecha(x.creado_en)}{x.estado === 'activa' && x.decidido_en ? ` · activa desde ${fecha(x.decidido_en)}` : ''}{x.vigente_hasta ? ` · ${x.vigente_hasta < new Date().toLocaleDateString('en-CA') ? '⏹ venció' : 'vigente hasta'} ${fecha(x.vigente_hasta)}` : ' · sin fecha de vencimiento'}</div>
          <div className="row">
            {x.estado === 'pendiente'
              ? <><AsyncButton className="sm" okText="Activa" onClick={() => decidir(x, 'activa')}>✓ Activar</AsyncButton><button className="sec sm" onClick={() => integrar(x)}>📌 Al prompt</button><AsyncButton className="sec sm" okText="Descartada" onClick={() => decidir(x, 'descartada')}>Descartar</AsyncButton></>
              : x.estado === 'integrada' ? <span className="badge ok">En el prompt maestro</span>
              : <><button className="sec sm" onClick={() => integrar(x)}>📌 Agregar al prompt</button><AsyncButton className="sec sm" okText="Desactivada" onClick={() => decidir(x, 'descartada')}>Desactivar</AsyncButton></>}
            {x.estado !== 'integrada' && <button className="sec sm" onClick={() => setEdit({ id: x.id, texto: x.regla, hasta: x.vigente_hasta ?? '' })}>Editar</button>}
          </div></>}
    </div>
  )

  return (
    <>
      {parte !== 'respaldos' && <div className="card"><h2>🧠 Aprendizaje del bot</h2>
        <p className="muted">La IA revisa las conversaciones (con venta o sin ella), detecta fricciones del bot y propone reglas. También aprende de <b>cómo y qué respondes tú</b> cuando atiendes un chat: tu estilo, los datos que das y tus criterios. Tú decides cuáles activar; las activas se suman al prompt automáticamente.</p>
        <Switch color="verde" checked={auto} onChange={async (v) => { await save('aprendizaje_auto', v ? 'si' : 'no'); toast(v ? 'Aprendizaje automático activado: las sugerencias nuevas se activan solas' : 'Aprendizaje automático apagado: las sugerencias nuevas esperan tu aprobación', 'info') }}
          label="Aprendizaje automático: activar solas las sugerencias nuevas (puedes desactivar cualquiera después)" />
        <div className="row"><AsyncButton className="sec" okText="Revisadas" onClick={revisar}>Revisar conversaciones ahora</AsyncButton><AsyncButton className="sec" okText="Revisadas" onClick={aprenderEquipo}>Aprender de mis respuestas</AsyncButton></div>
        <h3 style={{ fontSize: 14, margin: '12px 0 4px' }}>Por aprobar ({pendientes.length})</h3>
        <Grupos l={pendientes} />
        {!pendientes.length && <p className="muted">No hay reglas propuestas. Se revisan solas unas pocas conversaciones en cada ciclo del cron.</p>}
        <h3 style={{ fontSize: 14, margin: '12px 0 4px' }}>Activas ({activas.length})</h3>
        <Grupos l={activas} />
        {integradas.length > 0 && <><h3 style={{ fontSize: 14, margin: '12px 0 4px' }}>Ya en el prompt maestro ({integradas.length})</h3><Grupos l={integradas} /></>}
        <label>Agregar una regla tú mismo</label>
        <div className="row"><input placeholder="ej. Si el cliente escribe Nequii, entiende Nequi" value={nueva} onChange={(e) => setNueva(e.target.value)} /><input type="date" style={{ maxWidth: 170 }} title="Vigente hasta (opcional)" min={new Date().toLocaleDateString('en-CA')} value={nuevaHasta} onChange={(e) => setNuevaHasta(e.target.value)} /><AsyncButton okText="Agregada" onClick={agregar}>Agregar</AsyncButton></div>
      </div>}

      {parte !== 'reglas' && <div className="card"><h2>💾 Respaldos del bot</h2>
        <p className="muted">Guardan el prompt, el modelo, el proveedor, la configuración y las reglas aprendidas. Se crean solos antes de cada cambio de prompt o modelo (últimos 60) y puedes crear los tuyos; los manuales no se borran.</p>
        <div className="row"><AsyncButton okText="Respaldo creado" onClick={respaldar}>Crear respaldo ahora</AsyncButton></div>
        {resp.map((b) => (
          <div className="fila-item" key={b.id} style={{ padding: '8px 0', borderTop: '1px solid var(--bd)' }}>
            <div className="crece"><b>{new Date(b.creado_en).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}</b> {b.automatico ? <span className="badge">auto</span> : <span className="badge ok">manual</span>}
              <div className="muted">{b.nota} · {b.config.proveedor_ia ?? '?'} {b.config.modelo_ia ?? ''} · prompt {(b.config.system_prompt ?? '').length} caracteres</div></div>
            <button className="sec sm" onClick={() => descargar(b)}>⬇</button>
            <button className="sec sm" onClick={() => restaurar(b)}>Restaurar</button>
          </div>))}
      </div>}
      <Confirmar c={conf} onClose={() => setConf(null)} />
    </>
  )
}
