import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useConfig } from '../hooks'

type M = { id: string; nombre: string; numero_cuenta: string; tipo_cuenta: string }
type H = { id: string; valor_anterior: string; cambiado_en: string }

export default function Configuracion() {
  const { cfg, save } = useConfig()
  const [f, setF] = useState<Record<string, string>>({})
  const [metodos, setMetodos] = useState<M[]>([])
  const [hist, setHist] = useState<H[]>([])
  const [keys, setKeys] = useState<Record<string, string>>({ claude: '', openai: '', gemini: '' })
  const [tiene, setTiene] = useState<Record<string, boolean>>({})
  const [probando, setProbando] = useState(false)
  const [prueba, setPrueba] = useState<{ ok: boolean; texto: string } | null>(null)
  const [msg, setMsg] = useState('')

  const loadM = async () => { const { data } = await supabase.from('metodos_pago').select('*').order('nombre'); setMetodos(data ?? []) }
  const loadH = async () => {
    const { data: c } = await supabase.from('config').select('id').eq('clave', 'system_prompt').maybeSingle()
    if (!c) return
    const { data } = await supabase.from('config_historial').select('*').eq('config_id', c.id).order('cambiado_en', { ascending: false }).limit(10)
    setHist(data ?? [])
  }
  useEffect(() => { setF(cfg) }, [cfg])
  useEffect(() => {
    loadM(); loadH()
    ;['claude', 'openai', 'gemini'].forEach((p) =>
      supabase.rpc('secreto_configurado', { p_clave: `key_${p}` }).then(({ data }) => setTiene((t) => ({ ...t, [p]: !!data }))))
  }, [])

  const set = (k: string, v: string) => setF({ ...f, [k]: v })
  const guardarTodo = async () => {
    for (const k of ['system_prompt', 'dias_produccion', 'franjas_entrega', 'admin_numeros', 'domiciliario_numero', 'horas_humano', 'proveedor_ia', 'motor_audio', 'modelo_ia', 'numero_atencion', 'simular_escritura', 'velocidad_escritura_ms', 'espera_agrupar_seg', 'seguimiento_activo', 'seguimiento_1_min', 'seguimiento_2_min', 'horario_inicio', 'horario_fin', 'umbral_pedido_grande', 'logo_url'])
      if ((f[k] ?? '') !== (cfg[k] ?? '')) await save(k, f[k] ?? '')
    setMsg('Guardado'); loadH()
  }
  const guardarKey = async (p: string) => {
    if (!keys[p]) return
    const { error } = await supabase.rpc('set_secreto', { p_clave: `key_${p}`, p_valor: keys[p] })
    if (error) return setMsg(error.message)
    setKeys({ ...keys, [p]: '' }); setTiene({ ...tiene, [p]: true }); setMsg(`API key de ${p} guardada`)
  }
  const probar = async () => {
    setProbando(true); setPrueba(null)
    const { data, error } = await supabase.functions.invoke('probar-ia')
    setProbando(false)
    if (error || !data) return setPrueba({ ok: false, texto: error?.message ?? 'Sin respuesta de la función (¿está desplegada?)' })
    const audio = data.audio?.clave_configurada ? `Audio (${data.audio.motor}): clave lista` : `Audio (${data.audio?.motor}): FALTA la API key`
    setPrueba(data.ok
      ? { ok: true, texto: `Chat OK con ${data.proveedor} / ${data.modelo} (${data.ms} ms). ${audio}` }
      : { ok: false, texto: `Chat con error: ${data.error}. ${audio}` })
  }
  const logo = async (file: File) => {
    const path = `logo-${Date.now()}.${file.name.split('.').pop()}`
    const { error } = await supabase.storage.from('catalogo').upload(path, file, { contentType: file.type })
    if (error) return setMsg(error.message)
    set('logo_url', supabase.storage.from('catalogo').getPublicUrl(path).data.publicUrl)
  }
  const updM = (id: string, p: Partial<M>) => setMetodos(metodos.map((m) => (m.id === id ? { ...m, ...p } : m)))
  const saveM = async (m: M) => { const { id, ...r } = m; await supabase.from('metodos_pago').update(r).eq('id', id); setMsg('Método guardado') }
  const addM = async () => { await supabase.from('metodos_pago').insert({ nombre: 'Nequi' }); loadM() }
  const delM = async (id: string) => { await supabase.from('metodos_pago').delete().eq('id', id); loadM() }

  return (
    <>
      <p className="muted">{msg}</p>
      <div className="card"><h2>Bot</h2>
        <label>Proveedor de IA (chat y lectura de comprobantes)</label>
        <select value={f.proveedor_ia ?? 'gemini'} onChange={(e) => set('proveedor_ia', e.target.value)}>
          <option value="gemini">Gemini (pruebas, capa gratuita)</option><option value="claude">Claude</option><option value="openai">OpenAI</option></select>
        <label>Motor de lectura de audios</label>
        <select value={f.motor_audio ?? 'gemini'} onChange={(e) => set('motor_audio', e.target.value)}>
          <option value="gemini">Gemini</option><option value="openai">OpenAI (Whisper)</option></select>
        <label>Modelo (opcional, vacío = el recomendado del proveedor)</label>
        <input placeholder="ej. gemini-2.5-flash" value={f.modelo_ia ?? ''} onChange={(e) => set('modelo_ia', e.target.value)} />
        {(['gemini', 'claude', 'openai'] as const).map((p) => (
          <div key={p}><label>API key de {p} {tiene[p] && <span className="badge ok">configurada</span>}</label>
            <div className="row"><input type="password" autoComplete="off" placeholder={tiene[p] ? '•••••••• (pegar para reemplazar)' : 'Pegar API key'}
              value={keys[p]} onChange={(e) => setKeys({ ...keys, [p]: e.target.value })} />
              <button onClick={() => guardarKey(p)}>Guardar key</button></div></div>))}
        <p className="muted">Guarda primero los cambios de arriba (botón "Guardar configuración") y luego prueba.</p>
        <div className="row"><button className="sec" onClick={probar} disabled={probando}>{probando ? 'Probando…' : 'Probar IA'}</button></div>
        {prueba && <p className={prueba.ok ? 'muted' : 'err'}>{prueba.ok ? '✅ ' : '❌ '}{prueba.texto}</p>}
        <label>System prompt</label>
        <textarea value={f.system_prompt ?? ''} onChange={(e) => set('system_prompt', e.target.value)} />
        {hist.length > 0 && <details><summary>Historial de versiones</summary>
          {hist.map((h) => (<div key={h.id} className="row"><span className="muted">{new Date(h.cambiado_en).toLocaleString()}</span>
            <button className="sec sm" onClick={() => set('system_prompt', h.valor_anterior)}>Restaurar</button></div>))}</details>}
      </div>
      <div className="card"><h2>Comportamiento natural y seguimiento</h2>
        <label>Número de atención personalizada (el bot lo da cuando no puede ayudar; ej. 573001234567)</label>
        <input value={f.numero_atencion ?? ''} onChange={(e) => set('numero_atencion', e.target.value)} />
        <label>Pedidos grandes: desde cuántas galletas en un pedido el bot consulta con el admin (por defecto 30)</label>
        <input type="number" min={1} value={f.umbral_pedido_grande ?? '30'} onChange={(e) => set('umbral_pedido_grande', e.target.value)} />
        <label>Simular "escribiendo…" y pausas entre mensajes</label>
        <select value={f.simular_escritura ?? 'si'} onChange={(e) => set('simular_escritura', e.target.value)}><option value="si">Sí</option><option value="no">No</option></select>
        <label>Velocidad de escritura (milisegundos por carácter; más alto = más lento)</label>
        <input type="number" min={5} value={f.velocidad_escritura_ms ?? '35'} onChange={(e) => set('velocidad_escritura_ms', e.target.value)} />
        <label>Segundos de espera antes de responder, por si el cliente sigue escribiendo (0 = responder ya)</label>
        <input type="number" min={0} value={f.espera_agrupar_seg ?? '4'} onChange={(e) => set('espera_agrupar_seg', e.target.value)} />
        <label>Recordatorios automáticos si el cliente no responde</label>
        <select value={f.seguimiento_activo ?? 'si'} onChange={(e) => set('seguimiento_activo', e.target.value)}><option value="si">Activados</option><option value="no">Desactivados</option></select>
        <div className="row">
          <div><label>1.er recordatorio (minutos)</label><input type="number" min={5} value={f.seguimiento_1_min ?? '45'} onChange={(e) => set('seguimiento_1_min', e.target.value)} /></div>
          <div><label>2.º y último (minutos)</label><input type="number" min={5} value={f.seguimiento_2_min ?? '360'} onChange={(e) => set('seguimiento_2_min', e.target.value)} /></div></div>
        <div className="row">
          <div><label>Enviar desde (hora)</label><input type="number" min={0} max={23} value={f.horario_inicio ?? '7'} onChange={(e) => set('horario_inicio', e.target.value)} /></div>
          <div><label>Hasta (hora)</label><input type="number" min={1} max={24} value={f.horario_fin ?? '20'} onChange={(e) => set('horario_fin', e.target.value)} /></div></div>
        <p className="muted">WhatsApp solo permite mensajes libres dentro de las 24 h posteriores al último mensaje del cliente; pasado ese plazo no se envían recordatorios.</p>
      </div>
      <div className="card"><h2>Operación</h2>
        <label>Días de producción (ej. miercoles,viernes)</label><input value={f.dias_produccion ?? ''} onChange={(e) => set('dias_produccion', e.target.value)} />
        <label>Franjas horarias de entrega (separadas por coma)</label><input value={f.franjas_entrega ?? ''} onChange={(e) => set('franjas_entrega', e.target.value)} />
        <label>Números admin autorizados (WhatsApp, separados por coma)</label><input value={f.admin_numeros ?? ''} onChange={(e) => set('admin_numeros', e.target.value)} />
        <label>Horas de atención humana antes de que el bot se reactive solo (por defecto 12)</label><input type="number" min={1} value={f.horas_humano ?? '12'} onChange={(e) => set('horas_humano', e.target.value)} />
        <label>Número del domiciliario (WhatsApp, con indicativo, ej. 573001234567)</label><input value={f.domiciliario_numero ?? ''} onChange={(e) => set('domiciliario_numero', e.target.value)} />
        <label>Logo del micrositio</label>{f.logo_url && <img className="thumb" src={f.logo_url} alt="logo" />}
        <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && logo(e.target.files[0])} />
      </div>
      <button onClick={guardarTodo}>Guardar configuración</button>
      <div className="card" style={{ marginTop: 12 }}><h2>Métodos de pago</h2>
        {metodos.map((m) => (<div className="row" key={m.id}>
          <input placeholder="Nombre" value={m.nombre} onChange={(e) => updM(m.id, { nombre: e.target.value })} />
          <input placeholder="Número de cuenta" value={m.numero_cuenta} onChange={(e) => updM(m.id, { numero_cuenta: e.target.value })} />
          <input placeholder="Tipo de cuenta" value={m.tipo_cuenta} onChange={(e) => updM(m.id, { tipo_cuenta: e.target.value })} />
          <button className="sm" onClick={() => saveM(m)}>OK</button><button className="sec sm" onClick={() => delM(m.id)}>×</button></div>))}
        <button className="sec" onClick={addM}>+ Agregar método</button></div>
    </>
  )
}
