import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useConfig } from '../hooks'
import AprendizajeBot from '../AprendizajeBot'
import AvisosBot from '../AvisosBot'
import { sonidoActivo, setSonidoActivo, tono } from '../sonido'
import { AsyncButton, Confirmar, Modal, Switch, useToast, type Confirmacion } from '../ui'

type M = { id: string; nombre: string; numero_cuenta: string; tipo_cuenta: string; activo: boolean }
type H = { id: string; valor_anterior: string; cambiado_en: string }
const CLAVES = ['system_prompt', 'dias_produccion', 'franjas_entrega', 'admin_numeros', 'domiciliario_numero', 'horas_humano', 'minutos_humano_sin_responder', 'proveedor_ia', 'motor_audio',
  'modelo_ia', 'numero_atencion', 'simular_escritura', 'velocidad_escritura_ms', 'espera_agrupar_seg', 'seguimiento_activo', 'local_nombre', 'local_direccion', 'local_lat', 'local_lng', 'barrios_sin_domicilio', 'seguimiento_1_min',
  'seguimiento_2_min', 'horario_inicio', 'horario_fin', 'umbral_pedido_grande', 'anticipacion_minima_min', 'permitir_reserva_sin_stock', 'logo_url']

export default function Configuracion() {
  const toast = useToast()
  const { cfg, save } = useConfig()
  const [f, setF] = useState<Record<string, string>>({})
  const [sec, setSec] = useState<string | null>(null)
  const [sonidoOn, setSonidoOn] = useState(sonidoActivo())
  const cambiarSonido = (v: boolean) => { setSonidoActivo(v); setSonidoOn(v); if (v) tono() }
  const [metodos, setMetodos] = useState<M[]>([])
  const [hist, setHist] = useState<H[]>([])
  const [keys, setKeys] = useState<Record<string, string>>({ claude: '', openai: '', gemini: '' })
  const [tiene, setTiene] = useState<Record<string, boolean>>({})
  const [prueba, setPrueba] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ed, setEd] = useState<{ id: string; nombre: string; numero_cuenta: string; tipo_cuenta: string } | null>(null)
  const [err, setErr] = useState<Record<string, boolean>>({})
  const [conf, setConf] = useState<Confirmacion | null>(null)

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
  const cambios = CLAVES.filter((k) => (f[k] ?? '') !== (cfg[k] ?? ''))

  const guardarTodo = async () => {
    for (const k of cambios) await save(k, f[k] ?? '')
    toast('Configuración guardada'); loadH()
  }
  const guardarKey = async (p: string) => {
    if (!keys[p]) { toast('Pega primero la API key', 'err'); return false }
    const { error } = await supabase.rpc('set_secreto', { p_clave: `key_${p}`, p_valor: keys[p] })
    if (error) { toast(error.message, 'err'); return false }
    setKeys({ ...keys, [p]: '' }); setTiene({ ...tiene, [p]: true }); toast(`API key de ${p} guardada`)
  }
  const probar = async () => {
    setPrueba(null)
    const { data, error } = await supabase.functions.invoke('probar-ia')
    if (error || !data) { setPrueba({ ok: false, texto: error?.message ?? 'Sin respuesta de la función (¿está desplegada?)' }); return false }
    const audio = data.audio?.clave_configurada ? `Audio (${data.audio.motor}): clave lista` : `Audio (${data.audio?.motor}): FALTA la API key`
    setPrueba(data.ok ? { ok: true, texto: `Chat OK con ${data.proveedor} / ${data.modelo} (${data.ms} ms). ${audio}` } : { ok: false, texto: `Chat con error: ${data.error}. ${audio}` })
    return data.ok as boolean
  }
  const logo = async (file: File) => {
    const path = `logo-${Date.now()}.${file.name.split('.').pop()}`
    const { error } = await supabase.storage.from('catalogo').upload(path, file, { contentType: file.type })
    if (error) return toast(error.message, 'err')
    set('logo_url', supabase.storage.from('catalogo').getPublicUrl(path).data.publicUrl); toast('Logo cargado: guarda la configuración para aplicarlo', 'info')
  }

  // ---------- Métodos de pago: nombre y número obligatorios; el tipo es opcional ----------
  const guardarMetodo = async () => {
    if (!ed) return false
    const e = { nombre: !ed.nombre.trim(), numero: !ed.numero_cuenta.trim() }
    setErr(e)
    if (e.nombre || e.numero) { toast('El nombre y el número son obligatorios', 'err'); return false }
    const fila = { nombre: ed.nombre.trim(), numero_cuenta: ed.numero_cuenta.trim(), tipo_cuenta: ed.tipo_cuenta.trim() }
    const { error } = ed.id ? await supabase.from('metodos_pago').update(fila).eq('id', ed.id) : await supabase.from('metodos_pago').insert(fila)
    if (error) { toast(error.message, 'err'); return false }
    toast(ed.id ? 'Método de pago actualizado' : 'Método de pago agregado'); await loadM(); setTimeout(() => setEd(null), 450)
  }
  const alternarMetodo = async (m: M, activo: boolean) => {
    setMetodos((l) => l.map((x) => (x.id === m.id ? { ...x, activo } : x)))
    const { error } = await supabase.from('metodos_pago').update({ activo }).eq('id', m.id)
    if (error) { toast(error.message, 'err'); loadM() }
  }
  const borrarMetodo = (m: M) => setConf({ titulo: 'Eliminar método de pago', peligro: true, okText: 'Eliminar', texto: <>¿Eliminar <b>{m.nombre}</b>? El bot dejará de ofrecerlo.</>,
    onOk: async () => { const { error } = await supabase.from('metodos_pago').delete().eq('id', m.id); if (error) { toast(error.message, 'err'); return false } toast('Método eliminado'); loadM() } })
  const efectivo = (f.acepta_efectivo ?? cfg.acepta_efectivo ?? 'si') !== 'no'
  const alternarEfectivo = async (v: boolean) => { setF((x) => ({ ...x, acepta_efectivo: v ? 'si' : 'no' })); await save('acepta_efectivo', v ? 'si' : 'no'); toast(v ? 'Efectivo contraentrega habilitado' : 'Efectivo contraentrega deshabilitado') }

  return (
    <>
      <h2 style={{ margin: '4px 0 10px' }}>Configuración</h2>
      <div className="tiles">
        <button className="tile" onClick={() => setSec('bot')}><span className="tile-ico">🤖</span><b>Bot e IA</b><span className="muted">Proveedor, claves, prompt y versiones</span></button>
        <button className="tile" onClick={() => setSec('avisos')}><span className="tile-ico">📣</span><b>Avisos temporales</b><span className="muted">Eventos e instrucciones con fecha</span></button>
        <button className="tile" onClick={() => setSec('pagos')}><span className="tile-ico">💳</span><b>Métodos de pago</b><span className="muted">Cuentas y efectivo</span></button>
        <button className="tile" onClick={() => setSec('comp')}><span className="tile-ico">💬</span><b>Comportamiento y seguimiento</b><span className="muted">Escritura natural, recordatorios, pedidos grandes</span></button>
        <button className="tile" onClick={() => setSec('oper')}><span className="tile-ico">🗓</span><b>Operación</b><span className="muted">Días de producción, franjas, reservas</span></button>
        <button className="tile" onClick={() => setSec('local')}><span className="tile-ico">📍</span><b>Local y zonas</b><span className="muted">Dirección, pin y barrios sin domicilio</span></button>
        <button className="tile" onClick={() => setSec('equipo')}><span className="tile-ico">👥</span><b>Equipo y números</b><span className="muted">Admins, domiciliario, atención humana</span></button>
        <button className="tile" onClick={() => setSec('marca')}><span className="tile-ico">🎨</span><b>Marca y notificaciones</b><span className="muted">Logo, ícono de la app y sonido</span></button>
        <button className="tile" onClick={() => setSec('aprende')}><span className="tile-ico">🧠</span><b>Aprendizaje del bot</b><span className="muted">Reglas propuestas por la IA</span></button>
        <button className="tile" onClick={() => setSec('respaldos')}><span className="tile-ico">💾</span><b>Respaldos</b><span className="muted">Copias del prompt, modelo y reglas</span></button>
      </div>

      <Modal abierto={sec === 'bot'} titulo="🤖 Bot e IA" onClose={() => setSec(null)} ancho={560}
        pie={<><span className="muted" style={{ marginRight: 'auto' }}>{cambios.length ? `${cambios.length} cambio${cambios.length === 1 ? '' : 's'} sin guardar` : 'Todo guardado'}</span><button className="sec" onClick={() => setSec(null)}>Cerrar</button><AsyncButton okText="Guardado" disabled={!cambios.length} onClick={guardarTodo}>Guardar</AsyncButton></>}>
        {sec === 'bot' && (<>
<div>
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
              <AsyncButton okText="Guardada" onClick={() => guardarKey(p)}>Guardar key</AsyncButton></div></div>))}
        <p className="muted">Guarda primero los cambios (barra inferior) y luego prueba.</p>
        <div className="row"><AsyncButton className="sec" okText="IA funcionando" onClick={probar}>Probar IA</AsyncButton></div>
        {prueba && <p className={prueba.ok ? 'muted' : 'err'}>{prueba.ok ? '✅ ' : '❌ '}{prueba.texto}</p>}
        <label>System prompt</label>
        <textarea value={f.system_prompt ?? ''} onChange={(e) => set('system_prompt', e.target.value)} />
        {hist.length > 0 && <details><summary>Historial de versiones</summary>
          {hist.map((h) => (<div key={h.id} className="row"><span className="muted">{new Date(h.cambiado_en).toLocaleString()}</span>
            <button className="sec sm" onClick={() => { set('system_prompt', h.valor_anterior); toast('Versión cargada: guarda para aplicarla', 'info') }}>Restaurar</button></div>))}</details>}
      </div>


        </>)}
      </Modal>
      <Modal abierto={sec === 'avisos'} titulo="📣 Avisos temporales" onClose={() => setSec(null)} ancho={560}
        pie={<><span className="muted" style={{ marginRight: 'auto' }}>{cambios.length ? `${cambios.length} cambio${cambios.length === 1 ? '' : 's'} sin guardar` : 'Todo guardado'}</span><button className="sec" onClick={() => setSec(null)}>Cerrar</button><AsyncButton okText="Guardado" disabled={!cambios.length} onClick={guardarTodo}>Guardar</AsyncButton></>}>
        {sec === 'avisos' && (<>
<AvisosBot />
        </>)}
      </Modal>
      <Modal abierto={sec === 'pagos'} titulo="💳 Métodos de pago" onClose={() => setSec(null)} ancho={560}
        pie={<><span className="muted" style={{ marginRight: 'auto' }}>{cambios.length ? `${cambios.length} cambio${cambios.length === 1 ? '' : 's'} sin guardar` : 'Todo guardado'}</span><button className="sec" onClick={() => setSec(null)}>Cerrar</button><AsyncButton okText="Guardado" disabled={!cambios.length} onClick={guardarTodo}>Guardar</AsyncButton></>}>
        {sec === 'pagos' && (<>
<div>
        <p className="muted">Solo estos medios (y el efectivo, si está habilitado) los ofrece el bot. Nombre y número son obligatorios; el tipo de cuenta es opcional.</p>
        <Switch checked={efectivo} onChange={alternarEfectivo} label="Aceptar efectivo contraentrega" />
        {metodos.map((m) => (
          <div className="fila-item" key={m.id} style={{ padding: '8px 0', borderTop: '1px solid var(--bd)', opacity: m.activo ? 1 : 0.55 }}>
            <div className="crece"><b>{m.nombre}</b><div className="muted">{m.numero_cuenta}{m.tipo_cuenta ? ` · ${m.tipo_cuenta}` : ''}</div></div>
            <Switch checked={m.activo} onChange={(v) => alternarMetodo(m, v)} />
            <button className="sec sm" onClick={() => { setErr({}); setEd({ id: m.id, nombre: m.nombre, numero_cuenta: m.numero_cuenta, tipo_cuenta: m.tipo_cuenta }) }}>Editar</button>
            <button className="sec sm" onClick={() => borrarMetodo(m)} aria-label="Eliminar">🗑</button>
          </div>))}
        <div style={{ marginTop: 10 }}><button className="sec" onClick={() => { setErr({}); setEd({ id: '', nombre: '', numero_cuenta: '', tipo_cuenta: '' }) }}>+ Agregar método</button></div>
      </div>


        </>)}
      </Modal>
      <Modal abierto={sec === 'comp'} titulo="💬 Comportamiento y seguimiento" onClose={() => setSec(null)} ancho={560}
        pie={<><span className="muted" style={{ marginRight: 'auto' }}>{cambios.length ? `${cambios.length} cambio${cambios.length === 1 ? '' : 's'} sin guardar` : 'Todo guardado'}</span><button className="sec" onClick={() => setSec(null)}>Cerrar</button><AsyncButton okText="Guardado" disabled={!cambios.length} onClick={guardarTodo}>Guardar</AsyncButton></>}>
        {sec === 'comp' && (<>
<div>
        <label>Número de atención personalizada (el bot lo da cuando no puede ayudar; ej. 573001234567)</label>
        <input value={f.numero_atencion ?? ''} onChange={(e) => set('numero_atencion', e.target.value)} />
        <label>Pedidos grandes: desde cuántas galletas en un pedido el bot consulta con el admin (por defecto 30)</label>
        <input type="number" min={1} value={f.umbral_pedido_grande ?? '30'} onChange={(e) => set('umbral_pedido_grande', e.target.value)} />
        <Switch checked={(f.simular_escritura ?? 'si') !== 'no'} onChange={(v) => set('simular_escritura', v ? 'si' : 'no')} label='Simular "escribiendo…" y pausas entre mensajes' />
        <label>Velocidad de escritura (milisegundos por carácter; más alto = más lento)</label>
        <input type="number" min={5} value={f.velocidad_escritura_ms ?? '35'} onChange={(e) => set('velocidad_escritura_ms', e.target.value)} />
        <label>Segundos de espera antes de responder, por si el cliente sigue escribiendo (0 = responder ya)</label>
        <input type="number" min={0} value={f.espera_agrupar_seg ?? '4'} onChange={(e) => set('espera_agrupar_seg', e.target.value)} />
        <Switch checked={(f.seguimiento_activo ?? 'si') !== 'no'} onChange={(v) => set('seguimiento_activo', v ? 'si' : 'no')} label="Recordatorios automáticos si el cliente no responde" />
        <div className="row">
          <div><label>1.er recordatorio (minutos)</label><input type="number" min={5} value={f.seguimiento_1_min ?? '10'} onChange={(e) => set('seguimiento_1_min', e.target.value)} /></div>
          <div><label>2.º y último (minutos)</label><input type="number" min={5} value={f.seguimiento_2_min ?? '360'} onChange={(e) => set('seguimiento_2_min', e.target.value)} /></div></div>
        <div className="row">
          <div><label>Enviar desde (hora)</label><input type="number" min={0} max={23} value={f.horario_inicio ?? '7'} onChange={(e) => set('horario_inicio', e.target.value)} /></div>
          <div><label>Hasta (hora)</label><input type="number" min={1} max={24} value={f.horario_fin ?? '20'} onChange={(e) => set('horario_fin', e.target.value)} /></div></div>
        <p className="muted">WhatsApp solo permite mensajes libres dentro de las 24 h posteriores al último mensaje del cliente; pasado ese plazo no se envían recordatorios.</p>
      </div>


        </>)}
      </Modal>
      <Modal abierto={sec === 'oper'} titulo="🗓 Operación" onClose={() => setSec(null)} ancho={560}
        pie={<><span className="muted" style={{ marginRight: 'auto' }}>{cambios.length ? `${cambios.length} cambio${cambios.length === 1 ? '' : 's'} sin guardar` : 'Todo guardado'}</span><button className="sec" onClick={() => setSec(null)}>Cerrar</button><AsyncButton okText="Guardado" disabled={!cambios.length} onClick={guardarTodo}>Guardar</AsyncButton></>}>
        {sec === 'oper' && (<>
<div>
        <label>Días de producción (ej. miercoles,viernes)</label><input value={f.dias_produccion ?? ''} onChange={(e) => set('dias_produccion', e.target.value)} />
        <label>Franjas horarias de entrega (separadas por coma)</label><input value={f.franjas_entrega ?? ''} onChange={(e) => set('franjas_entrega', e.target.value)} />
        <label>Pedidos para el mismo día: minutos de anticipación antes del cierre de entregas (por defecto 60)</label>
        <input type="number" min={0} value={f.anticipacion_minima_min ?? '60'} onChange={(e) => set('anticipacion_minima_min', e.target.value)} />
        <Switch checked={(f.permitir_reserva_sin_stock ?? 'si') !== 'no'} onChange={(v) => set('permitir_reserva_sin_stock', v ? 'si' : 'no')} label="Si no hay stock, dejar el pedido reservado para la siguiente producción (y avisarme)" />
      </div>
        </>)}
      </Modal>
      <Modal abierto={sec === 'local'} titulo="📍 Local y zonas" onClose={() => setSec(null)} ancho={560}
        pie={<><span className="muted" style={{ marginRight: 'auto' }}>{cambios.length ? `${cambios.length} cambio${cambios.length === 1 ? '' : 's'} sin guardar` : 'Todo guardado'}</span><button className="sec" onClick={() => setSec(null)}>Cerrar</button><AsyncButton okText="Guardado" disabled={!cambios.length} onClick={guardarTodo}>Guardar</AsyncButton></>}>
        {sec === 'local' && (<>
<div>
        <label>Nombre del local</label><input value={f.local_nombre ?? ''} onChange={(e) => set('local_nombre', e.target.value)} />
        <label>Dirección del local (la que el bot da al cliente)</label><input value={f.local_direccion ?? ''} onChange={(e) => set('local_direccion', e.target.value)} />
        <div className="row">
          <div><label>Latitud (pin del mapa)</label><input inputMode="decimal" value={f.local_lat ?? ''} onChange={(e) => set('local_lat', e.target.value)} /></div>
          <div><label>Longitud</label><input inputMode="decimal" value={f.local_lng ?? ''} onChange={(e) => set('local_lng', e.target.value)} /></div></div>
        <button type="button" className="sec" onClick={() => navigator.geolocation?.getCurrentPosition((p) => { set('local_lat', p.coords.latitude.toFixed(6)); set('local_lng', p.coords.longitude.toFixed(6)); toast('Ubicación actual tomada: guarda para aplicarla', 'info') }, () => toast('No se pudo obtener la ubicación (permite el acceso en el navegador)', 'err'))}>📍 Usar mi ubicación actual</button>
        <p className="muted">Si pones las coordenadas, el bot envía un pin de WhatsApp; si no, un enlace al mapa con la dirección. Tip: estando en el local, usa el botón.</p>
        <label>Barrios o zonas donde NO hacemos domicilio (separados por coma)</label>
        <textarea style={{ minHeight: 70 }} placeholder="ej. La Esperanza, El Resbalón, vereda Tierra Grande" value={f.barrios_sin_domicilio ?? ''} onChange={(e) => set('barrios_sin_domicilio', e.target.value)} />
        <p className="muted">Si la dirección del cliente contiene alguno de estos nombres, el bot le dice que ahí no hay domicilio y le ofrece recoger.</p>
      </div>
        </>)}
      </Modal>
      <Modal abierto={sec === 'equipo'} titulo="👥 Equipo y números" onClose={() => setSec(null)} ancho={560}
        pie={<><span className="muted" style={{ marginRight: 'auto' }}>{cambios.length ? `${cambios.length} cambio${cambios.length === 1 ? '' : 's'} sin guardar` : 'Todo guardado'}</span><button className="sec" onClick={() => setSec(null)}>Cerrar</button><AsyncButton okText="Guardado" disabled={!cambios.length} onClick={guardarTodo}>Guardar</AsyncButton></>}>
        {sec === 'equipo' && (<>
<div>
        <label>Números admin autorizados (WhatsApp, separados por coma)</label><input value={f.admin_numeros ?? ''} onChange={(e) => set('admin_numeros', e.target.value)} />
        <p className="muted">Desde estos números puedes escribirle al bot: <b>evento: …</b>, <b>instrucción: …</b>, <b>avisos</b>, <b>hoy: cacao 30</b>, <b>fabricadas: …</b>. Y enviarle una foto o video con el pie <b>foto: Cacao</b> (agrega al sabor) o <b>nuevo: Nombre, precio, descripción</b> (crea un sabor oculto).</p>
        <label>Si tardas más de estos minutos en responder a un cliente que atiendes tú, el bot retoma el chat (0 = nunca; por defecto 5)</label><input type="number" min={0} value={f.minutos_humano_sin_responder ?? '5'} onChange={(e) => set('minutos_humano_sin_responder', e.target.value)} />
        <label>Horas de atención humana antes de que el bot se reactive solo (por defecto 12)</label><input type="number" min={1} value={f.horas_humano ?? '12'} onChange={(e) => set('horas_humano', e.target.value)} />
        <label>Número del domiciliario (WhatsApp, con indicativo, ej. 573001234567)</label><input value={f.domiciliario_numero ?? ''} onChange={(e) => set('domiciliario_numero', e.target.value)} />
      </div>
        </>)}
      </Modal>
      <Modal abierto={sec === 'marca'} titulo="🎨 Marca y notificaciones" onClose={() => setSec(null)} ancho={560}
        pie={<><span className="muted" style={{ marginRight: 'auto' }}>{cambios.length ? `${cambios.length} cambio${cambios.length === 1 ? '' : 's'} sin guardar` : 'Todo guardado'}</span><button className="sec" onClick={() => setSec(null)}>Cerrar</button><AsyncButton okText="Guardado" disabled={!cambios.length} onClick={guardarTodo}>Guardar</AsyncButton></>}>
        {sec === 'marca' && (<>
<div>
        <label>Logo del micrositio</label>{f.logo_url && <img className="thumb" src={f.logo_url} alt="logo" />}
        <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && logo(e.target.files[0])} />
        <p className="muted">Este mismo logo se usa en el encabezado, como ícono de la app instalada y como favicon. Mejor una imagen cuadrada (mín. 512 px).</p>
        <Switch checked={sonidoOn} onChange={cambiarSonido} label="Sonido de notificaciones en este dispositivo (nuevo mensaje de cliente o aviso)" />
        <button type="button" className="sec" onClick={() => tono()}>🔔 Probar sonido</button>
      </div>
        </>)}
      </Modal>
      <Modal abierto={sec === 'aprende'} titulo="🧠 Aprendizaje del bot" onClose={() => setSec(null)} ancho={560}
        pie={<><span className="muted" style={{ marginRight: 'auto' }}>{cambios.length ? `${cambios.length} cambio${cambios.length === 1 ? '' : 's'} sin guardar` : 'Todo guardado'}</span><button className="sec" onClick={() => setSec(null)}>Cerrar</button><AsyncButton okText="Guardado" disabled={!cambios.length} onClick={guardarTodo}>Guardar</AsyncButton></>}>
        {sec === 'aprende' && (<>
<AprendizajeBot parte="reglas" />
        </>)}
      </Modal>
      <Modal abierto={sec === 'respaldos'} titulo="💾 Respaldos" onClose={() => setSec(null)} ancho={560}
        pie={<><span className="muted" style={{ marginRight: 'auto' }}>{cambios.length ? `${cambios.length} cambio${cambios.length === 1 ? '' : 's'} sin guardar` : 'Todo guardado'}</span><button className="sec" onClick={() => setSec(null)}>Cerrar</button><AsyncButton okText="Guardado" disabled={!cambios.length} onClick={guardarTodo}>Guardar</AsyncButton></>}>
        {sec === 'respaldos' && (<>
<AprendizajeBot parte="respaldos" />
        </>)}
      </Modal>

      <Modal abierto={!!ed} titulo={ed?.id ? 'Editar método de pago' : 'Nuevo método de pago'} onClose={() => setEd(null)} ancho={420}
        pie={<><button className="sec" onClick={() => setEd(null)}>Cancelar</button><AsyncButton okText="Guardado" onClick={guardarMetodo}>Guardar</AsyncButton></>}>
        {ed && <>
          <label>Nombre * (ej. Nequi, Bre-B, Bancolombia)</label>
          <input className={err.nombre ? 'invalido' : ''} autoFocus value={ed.nombre} onChange={(e) => setEd({ ...ed, nombre: e.target.value })} />
          <label>Número de cuenta o llave *</label>
          <input className={err.numero ? 'invalido' : ''} inputMode="text" value={ed.numero_cuenta} onChange={(e) => setEd({ ...ed, numero_cuenta: e.target.value })} />
          <label>Tipo de cuenta (opcional)</label>
          <input placeholder="ej. ahorros, corriente" value={ed.tipo_cuenta} onChange={(e) => setEd({ ...ed, tipo_cuenta: e.target.value })} />
        </>}
      </Modal>
      <Confirmar c={conf} onClose={() => setConf(null)} />
    </>
  )
}
