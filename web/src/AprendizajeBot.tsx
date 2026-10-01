import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { AsyncButton, Confirmar, useToast, type Confirmacion } from './ui'

type Regla = { id: string; regla: string; evidencia: string | null; origen_telefono: string | null; estado: 'pendiente' | 'activa' | 'descartada'; creado_en: string }
type Respaldo = { id: string; creado_en: string; automatico: boolean; nota: string | null; config: Record<string, string>; aprendizajes: unknown[] }

// Aprendizaje continuo (reglas que la IA propone a partir de las conversaciones) y respaldos del bot (prompt + modelo + reglas)
export default function AprendizajeBot({ parte }: { parte?: 'reglas' | 'respaldos' }) {
  const toast = useToast()
  const [reglas, setReglas] = useState<Regla[]>([])
  const [resp, setResp] = useState<Respaldo[]>([])
  const [nueva, setNueva] = useState('')
  const [edit, setEdit] = useState<{ id: string; texto: string } | null>(null)
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
    const { error } = await supabase.from('bot_aprendizajes').update({ regla: edit.texto.trim() }).eq('id', edit.id)
    if (error) { toast(error.message, 'err'); return false }
    setEdit(null); cargar()
  }
  const agregar = async () => {
    if (nueva.trim().length < 10) { toast('Escribe la regla completa (mín. 10 letras)', 'err'); return false }
    const { error } = await supabase.from('bot_aprendizajes').insert({ regla: nueva.trim(), estado: 'activa', decidido_en: new Date().toISOString() })
    if (error) { toast(error.message, 'err'); return false }
    setNueva(''); toast('Regla agregada y activa'); cargar()
  }
  const revisar = async () => {
    const { data, error } = await supabase.functions.invoke('analizar-chats', { body: { modo: 'aprender', limite: 5 } })
    if (error || !data?.ok) { toast(data?.error ?? error?.message ?? 'No se pudo revisar', 'err'); return false }
    toast(data.revisadas ? `${data.revisadas} conversación(es) revisada(s), ${data.reglas} regla(s) nueva(s)` : 'No hay conversaciones nuevas por revisar', 'info'); cargar()
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

  const pendientes = reglas.filter((r) => r.estado === 'pendiente'), activas = reglas.filter((r) => r.estado === 'activa')
  const Fila = ({ x }: { x: Regla }) => (
    <div className="regla">
      {edit?.id === x.id
        ? <><textarea style={{ minHeight: 60 }} value={edit.texto} onChange={(e) => setEdit({ id: x.id, texto: e.target.value })} />
          <div className="row"><AsyncButton okText="Guardada" onClick={guardarEdicion}>Guardar</AsyncButton><button className="sec" onClick={() => setEdit(null)}>Cancelar</button></div></>
        : <><div>{x.regla}</div>
          {x.evidencia && <div className="muted">Fricción detectada: {x.evidencia}</div>}
          <div className="row">
            {x.estado === 'pendiente'
              ? <><AsyncButton className="sm" okText="Activa" onClick={() => decidir(x, 'activa')}>✓ Activar</AsyncButton><AsyncButton className="sec sm" okText="Descartada" onClick={() => decidir(x, 'descartada')}>Descartar</AsyncButton></>
              : <AsyncButton className="sec sm" okText="Desactivada" onClick={() => decidir(x, 'descartada')}>Desactivar</AsyncButton>}
            <button className="sec sm" onClick={() => setEdit({ id: x.id, texto: x.regla })}>Editar</button>
          </div></>}
    </div>
  )

  return (
    <>
      {parte !== 'respaldos' && <div className="card"><h2>🧠 Aprendizaje del bot</h2>
        <p className="muted">La IA revisa las conversaciones (con venta o sin ella), detecta fricciones del bot y propone reglas. Tú decides cuáles activar; las activas se suman al prompt automáticamente.</p>
        <div className="row"><AsyncButton className="sec" okText="Revisadas" onClick={revisar}>Revisar conversaciones ahora</AsyncButton></div>
        <h3 style={{ fontSize: 14, margin: '12px 0 4px' }}>Por aprobar ({pendientes.length})</h3>
        {pendientes.map((x) => <Fila key={x.id} x={x} />)}
        {!pendientes.length && <p className="muted">No hay reglas propuestas. Se revisan solas unas pocas conversaciones en cada ciclo del cron.</p>}
        <h3 style={{ fontSize: 14, margin: '12px 0 4px' }}>Activas ({activas.length})</h3>
        {activas.map((x) => <Fila key={x.id} x={x} />)}
        <label>Agregar una regla tú mismo</label>
        <div className="row"><input placeholder="ej. Si el cliente escribe Nequii, entiende Nequi" value={nueva} onChange={(e) => setNueva(e.target.value)} /><AsyncButton okText="Agregada" onClick={agregar}>Agregar</AsyncButton></div>
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
