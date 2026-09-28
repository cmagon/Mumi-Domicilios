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
  const [apiKey, setApiKey] = useState('')
  const [tieneKey, setTieneKey] = useState(false)
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
    supabase.rpc('secreto_configurado', { p_clave: 'ia_api_key' }).then(({ data }) => setTieneKey(!!data))
  }, [])

  const set = (k: string, v: string) => setF({ ...f, [k]: v })
  const guardarTodo = async () => {
    for (const k of ['system_prompt', 'dias_produccion', 'franjas_entrega', 'admin_numeros', 'proveedor_ia', 'logo_url'])
      if ((f[k] ?? '') !== (cfg[k] ?? '')) await save(k, f[k] ?? '')
    setMsg('Guardado'); loadH()
  }
  const guardarKey = async () => {
    if (!apiKey) return
    const { error } = await supabase.rpc('set_secreto', { p_clave: 'ia_api_key', p_valor: apiKey })
    if (error) return setMsg(error.message)
    setApiKey(''); setTieneKey(true); setMsg('API key guardada')
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
        <label>Proveedor de IA</label>
        <select value={f.proveedor_ia ?? 'claude'} onChange={(e) => set('proveedor_ia', e.target.value)}>
          <option value="claude">Claude</option><option value="openai">OpenAI</option></select>
        <label>API key {tieneKey && <span className="badge ok">configurada</span>}</label>
        <div className="row"><input type="password" autoComplete="off" placeholder={tieneKey ? '•••••••• (pegar para reemplazar)' : 'Pegar API key'}
          value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <button onClick={guardarKey}>Guardar key</button></div>
        <label>System prompt</label>
        <textarea value={f.system_prompt ?? ''} onChange={(e) => set('system_prompt', e.target.value)} />
        {hist.length > 0 && <details><summary>Historial de versiones</summary>
          {hist.map((h) => (<div key={h.id} className="row"><span className="muted">{new Date(h.cambiado_en).toLocaleString()}</span>
            <button className="sec sm" onClick={() => set('system_prompt', h.valor_anterior)}>Restaurar</button></div>))}</details>}
      </div>
      <div className="card"><h2>Operación</h2>
        <label>Días de producción (ej. miercoles,viernes)</label><input value={f.dias_produccion ?? ''} onChange={(e) => set('dias_produccion', e.target.value)} />
        <label>Franjas horarias de entrega (separadas por coma)</label><input value={f.franjas_entrega ?? ''} onChange={(e) => set('franjas_entrega', e.target.value)} />
        <label>Números admin autorizados (WhatsApp, separados por coma)</label><input value={f.admin_numeros ?? ''} onChange={(e) => set('admin_numeros', e.target.value)} />
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
