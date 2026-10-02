// Análisis de conversaciones: para cada sesión cerrada que no terminó en venta, la IA clasifica por qué se truncó.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { chat } from './ai.ts'
import { construirProveedor } from './config.ts'

const SISTEMA = `Eres analista de ventas de Mumi, una marca de galletas que vende por WhatsApp. Analiza la conversación entre el cliente y el bot y responde SOLO un JSON con esta forma:
{"resultado":"truncada|atencion_humana|sin_intencion","motivo":"precio|sin_stock|fecha_entrega|domicilio_tarifa|metodo_pago|no_respondio|duda_sin_resolver|error_bot|solo_informacion|pidio_persona|otro","etapa":"saludo|catalogo|eleccion|entrega|datos|pago","resumen":"1 o 2 frases sobre qué pasó","sugerencia":"1 frase de cómo mejorar la conversación"}
Definiciones: "truncada" = el cliente mostró interés pero no compró; "atencion_humana" = se escaló o pidió hablar con una persona; "sin_intencion" = solo curioseaba o no buscaba comprar.
"etapa" es el punto donde se cayó la conversación. "motivo" es la causa principal; usa "no_respondio" si el cliente simplemente dejó de contestar sin razón aparente, y "error_bot" si el bot respondió mal, se contradijo o no entendió.`

export async function analizarSesiones(sb: SupabaseClient, cfg: Record<string, string>, limite = 5, foco?: { telefono: string; inicio: string }): Promise<number> {
  let q = sb.from('chat_sesiones').select('telefono,inicio,fin').eq('vendida', false).gte('mensajes_cliente', 1)
  if (foco) q = q.eq('telefono', foco.telefono).eq('inicio', foco.inicio)
  else q = q.is('resultado', null).lt('fin', new Date(Date.now() - 3 * 3600 * 1000).toISOString()).order('fin', { ascending: false }).limit(limite)
  const { data: sesiones } = await q
  if (!sesiones?.length) return 0
  const prov = await construirProveedor(sb, cfg)
  let hechas = 0
  for (const s of sesiones) {
    try {
      const { data: msgs } = await sb.from('mensajes').select('rol,contenido').eq('telefono', s.telefono)
        .gte('creado_en', s.inicio).lte('creado_en', s.fin).order('creado_en').limit(80)
      const texto = (msgs ?? []).map((m) => `${m.rol === 'user' ? 'Cliente' : m.rol === 'admin' ? 'Equipo (persona)' : 'Bot'}: ${String(m.contenido).slice(0, 300)}`).join('\n')
      const out = await chat(prov, SISTEMA, [{ role: 'user', content: texto }], [], async () => ({}))
      const j = out.match(/\{[\s\S]*\}/)
      if (!j) continue
      const r = JSON.parse(j[0])
      await sb.from('chats_analisis').upsert({
        telefono: s.telefono, sesion_inicio: s.inicio,
        resultado: ['truncada', 'atencion_humana', 'sin_intencion'].includes(r.resultado) ? r.resultado : 'truncada',
        motivo: r.motivo ?? 'otro', etapa: r.etapa ?? null, resumen: String(r.resumen ?? '').slice(0, 400), sugerencia: String(r.sugerencia ?? '').slice(0, 300),
        analizado_en: new Date().toISOString(),
      }, { onConflict: 'telefono,sesion_inicio' })
      hechas++
    } catch (e) { console.error('analizarSesion', e) }
  }
  return hechas
}

const SISTEMA_APRENDER = `Eres el coach del bot de ventas de Mumi (galletas por WhatsApp). Lee la conversación entre el Cliente, el Bot y el Equipo y detecta fricciones atribuibles al BOT: repetir información o preguntas, responder varias veces a mensajes seguidos, contradecirse (decir que hay galletas y luego que no), insistir en algo que el cliente ya resolvió, ignorar lo que dijo el cliente, pedir datos ya dados, mensajes confusos o no entender jerga y errores de escritura.
Responde SOLO un JSON: {"calidad":1-5,"fricciones":["..."],"reglas":["..."]}
"reglas" son de 0 a 3 instrucciones breves, generales y accionables, en imperativo y de máx. 200 caracteres, que evitarían esas fricciones con cualquier cliente. El aprendizaje es GLOBAL (no por cliente): generaliza. NUNCA incluyas datos personales, nombres, teléfonos ni precios o cifras exactas. Sé MUY selectivo: propón solo reglas realmente nuevas; NO repitas ni reformules nada que ya esté en el prompt del bot ni en las reglas registradas o descartadas (te los paso). Si dudas, no propongas. Si no hubo fricción: calidad 5 y listas vacías.`

// Con "aprendizaje automático" activado, las sugerencias nuevas se activan solas; si no, quedan por aprobar
const estadoNuevo = (cfg: Record<string, string>) => cfg.aprendizaje_auto === 'si' ? { estado: 'activa', decidido_en: new Date().toISOString() } : { estado: 'pendiente' }
// Palabras significativas de una regla; sirve para detectar casi-duplicados (no solo textos idénticos)
const palabras = (t: string) => new Set(norm(t).split(' ').filter((w) => w.length > 3))
const parecida = (a: string, existentes: Set<string>[]) => { const x = palabras(a); if (x.size < 3) return false; return existentes.some((y) => { let n = 0; x.forEach((w) => { if (y.has(w)) n++ }); return n / Math.min(x.size, y.size) >= 0.6 }) }
// Lo que el bot ya sabe: prompt maestro + reglas vigentes + reglas descartadas (esas no se vuelven a proponer)
async function conocido(sb: SupabaseClient, cfg: Record<string, string>) {
  const { data } = await sb.from('bot_aprendizajes').select('regla,estado').order('creado_en', { ascending: false }).limit(200)
  const reglas = (data ?? []).map((x: any) => x.regla as string)
  const prompt = String(cfg.system_prompt ?? '').slice(0, 9000)
  return { reglas, vistas: new Set(reglas.map(norm)), pal: [...reglas.map(palabras), ...prompt.split(/\n|(?<=[.!?])\s/).filter((l) => l.length > 25).map(palabras)],
    contexto: `PROMPT ACTUAL DEL BOT (lo que ya sabe; NO propongas nada que ya diga o implique):\n${prompt}\n\nReglas ya registradas o descartadas (NO las repitas ni las reformules):\n${reglas.map((r) => '- ' + r).join('\n') || '(ninguna)'}` }
}
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

// Aprendizaje continuo: revisa conversaciones cerradas (con o sin venta) y propone reglas nuevas (quedan "pendientes" hasta que el admin las active)
export async function aprenderDeSesiones(sb: SupabaseClient, cfg: Record<string, string>, limite = 3): Promise<{ revisadas: number; reglas: number }> {
  const { data: ses } = await sb.from('chat_sesiones').select('telefono,inicio,fin').gte('mensajes_cliente', 2)
    .lt('fin', new Date(Date.now() - 3600 * 1000).toISOString()).order('fin', { ascending: false }).limit(40)
  if (!ses?.length) return { revisadas: 0, reglas: 0 }
  const { data: hechas } = await sb.from('chats_revision').select('telefono,sesion_inicio').in('telefono', [...new Set(ses.map((x) => x.telefono))])
  const ya = new Set((hechas ?? []).map((h) => `${h.telefono}|${new Date(h.sesion_inicio).getTime()}`))
  const pend = ses.filter((x) => !ya.has(`${x.telefono}|${new Date(x.inicio).getTime()}`)).slice(0, limite)
  if (!pend.length) return { revisadas: 0, reglas: 0 }
  const k = await conocido(sb, cfg)
  const { vistas, pal } = k
  const prov = await construirProveedor(sb, cfg)
  let revisadas = 0, reglas = 0
  for (const s of pend) {
    try {
      const { data: msgs } = await sb.from('mensajes').select('rol,contenido').eq('telefono', s.telefono)
        .gte('creado_en', s.inicio).lte('creado_en', s.fin).order('creado_en').limit(100)
      const texto = (msgs ?? []).map((m) => `${m.rol === 'user' ? 'Cliente' : m.rol === 'admin' ? 'Equipo' : 'Bot'}: ${String(m.contenido).slice(0, 300)}`).join('\n')
      const out = await chat(prov, SISTEMA_APRENDER, [{ role: 'user', content: `${k.contexto}\n\nConversación:\n${texto}` }], [], async () => ({}))
      const j = out.match(/\{[\s\S]*\}/)
      if (!j) continue
      const r = JSON.parse(j[0])
      const fricciones = (Array.isArray(r.fricciones) ? r.fricciones : []).map((x: unknown) => String(x).slice(0, 200)).slice(0, 5)
      for (const regla of (Array.isArray(r.reglas) ? r.reglas : []).slice(0, 3)) {
        const t = String(regla).trim().slice(0, 240)
        if (t.length < 15 || vistas.has(norm(t)) || parecida(t, pal)) continue
        vistas.add(norm(t)); pal.push(palabras(t)); reglas++
        await sb.from('bot_aprendizajes').insert({ regla: t, evidencia: ((fricciones.join(' · ') || '') + (cfg.aprendizaje_auto === 'si' ? ' · activada automáticamente' : '')) || null, origen_telefono: s.telefono, ...estadoNuevo(cfg) })
      }
      await sb.from('chats_revision').upsert({ telefono: s.telefono, sesion_inicio: s.inicio, calidad: Math.min(5, Math.max(1, Number(r.calidad) || 3)), fricciones }, { onConflict: 'telefono,sesion_inicio' })
      revisadas++
    } catch (e) { console.error('aprenderDeSesion', e) }
  }
  return { revisadas, reglas }
}

const SISTEMA_EXTRAER = `Eres asistente del equipo de Mumi (galletas por WhatsApp). Lee la conversación y extrae el pedido que el cliente está armando o dejó a medias, usando SOLO lo que realmente dijo (si no lo dijo, null). Responde SOLO un JSON:
{"nombre":string|null,"telefono_contacto":string|null,"items":[{"sabor":"nombre EXACTO de la lista de sabores","cantidad":número}],"modalidad":"domicilio"|"recoger"|null,"direccion":string|null,"zona_tarifa":"nombre EXACTO de la lista de tarifas"|null,"metodo_pago":"nombre EXACTO de la lista de métodos"|"Efectivo"|null,"fecha_entrega":"YYYY-MM-DD"|null,"hora_entrega":"HH:MM"|null,"franja":string|null,"nota":"observaciones vigentes, resumidas (la última decisión del cliente)"|null,"resumen":"1 frase de en qué quedó la conversación"}`

// Prellena el pedido manual a partir de la conversación (el admin lo revisa y completa)
export async function extraerPedido(sb: SupabaseClient, cfg: Record<string, string>, telefono: string): Promise<Record<string, unknown>> {
  const [{ data: prods }, { data: tars }, { data: mets }, { data: msgs }] = await Promise.all([
    sb.from('productos').select('nombre').eq('activo', true), sb.from('tarifas_domicilio').select('nombre').eq('activo', true),
    sb.from('metodos_pago').select('nombre').eq('activo', true),
    sb.from('mensajes').select('rol,contenido,creado_en').eq('telefono', telefono).order('creado_en', { ascending: false }).limit(60)])
  const texto = (msgs ?? []).reverse().map((m) => `${m.rol === 'user' ? 'Cliente' : m.rol === 'admin' ? 'Equipo' : 'Bot'}: ${String(m.contenido).slice(0, 300)}`).join('\n')
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
  const prov = await construirProveedor(sb, cfg)
  const out = await chat(prov, SISTEMA_EXTRAER, [{ role: 'user', content: `Hoy es ${hoy}.\nSabores: ${(prods ?? []).map((x) => x.nombre).join(', ')}\nTarifas de domicilio: ${(tars ?? []).map((x) => x.nombre).join(', ')}\nMétodos de pago: ${(mets ?? []).map((x) => x.nombre).join(', ')}\n\nConversación:\n${texto}` }], [], async () => ({}))
  const j = out.match(/\{[\s\S]*\}/)
  return j ? JSON.parse(j[0]) : {}
}

const SISTEMA_EQUIPO = `Eres el coach del bot de ventas de Mumi (galletas/repostería por WhatsApp). Lee una conversación donde una PERSONA del equipo ("Equipo") respondió al cliente (a veces tomó el chat que llevaba el bot). Extrae lo que el BOT debería aprender de la persona. Responde SOLO un JSON: {"reglas":[{"tipo":"estilo"|"conocimiento"|"politica","texto":"..."}]}
- "estilo": cómo habla la persona (tono, saludos, muletillas, nivel de formalidad, uso de emojis, longitud) → instrucción en imperativo para imitarla, con un ejemplo corto entre comillas si ayuda.
- "conocimiento": datos concretos que la persona dio y que el bot no sabía (ingredientes, ubicación, tiempos, cómo se hace algo) → "Si preguntan X, responde: …". No incluyas precios si pueden cambiar, ni datos personales.
- "politica": decisiones o excepciones del equipo (qué hace ante una queja, un cambio, un pedido especial, p. ej. "se puede conceder descuento por compras grandes"). El aprendizaje es GLOBAL: lo acordado con un cliente aplica a otros que pregunten lo mismo; redáctalo como criterio general SIN cantidades, porcentajes ni precios exactos (di "se puede estudiar un descuento" y que el equipo confirma la cifra).
Reglas: máx. 4 elementos, cada texto de máx. 240 caracteres, generales (sirven para otros clientes), sin nombres ni teléfonos. Sé MUY selectivo: solo lo realmente nuevo; NO repitas ni reformules nada que ya esté en el prompt del bot ni en las reglas registradas o descartadas (te los paso). Si dudas, devuelve []. Si no hay nada útil: {"reglas":[]}.`

// Aprende de cómo y qué responde el equipo (humano): estilo, conocimiento y políticas. Quedan como reglas "pendientes" para aprobar.
export async function aprenderDelEquipo(sb: SupabaseClient, cfg: Record<string, string>, limite = 3): Promise<{ revisadas: number; reglas: number }> {
  const { data: ses } = await sb.from('chat_sesiones').select('telefono,inicio,fin').order('fin', { ascending: false }).limit(60)
  if (!ses?.length) return { revisadas: 0, reglas: 0 }
  const { data: hechas } = await sb.from('chats_revision').select('telefono,sesion_inicio,equipo_revisado_en').in('telefono', [...new Set(ses.map((x) => x.telefono))])
  const ya = new Set((hechas ?? []).filter((h: any) => h.equipo_revisado_en).map((h: any) => `${h.telefono}|${new Date(h.sesion_inicio).getTime()}`))
  const k = await conocido(sb, cfg)
  const { vistas, pal } = k
  const prov = await construirProveedor(sb, cfg)
  let revisadas = 0, reglas = 0
  for (const s of ses) {
    if (revisadas >= limite) break
    if (ya.has(`${s.telefono}|${new Date(s.inicio).getTime()}`)) continue
    if (Date.now() - new Date(s.fin).getTime() < 3600 * 1000) continue // la conversación ya cerró
    const { data: msgs } = await sb.from('mensajes').select('rol,contenido').eq('telefono', s.telefono).gte('creado_en', s.inicio).lte('creado_en', s.fin).order('creado_en').limit(100)
    if (!(msgs ?? []).some((m) => m.rol === 'admin')) continue // sin intervención humana: nada que aprender del equipo
    try {
      const texto = (msgs ?? []).map((m) => `${m.rol === 'user' ? 'Cliente' : m.rol === 'admin' ? 'Equipo' : 'Bot'}: ${String(m.contenido).slice(0, 300)}`).join('\n')
      const out = await chat(prov, SISTEMA_EQUIPO, [{ role: 'user', content: `${k.contexto}\n\nConversación:\n${texto}` }], [], async () => ({}))
      const j = out.match(/\{[\s\S]*\}/)
      if (j) for (const r of (JSON.parse(j[0]).reglas ?? []).slice(0, 4)) {
        const t = String(r.texto ?? '').trim().slice(0, 260)
        if (t.length < 15 || vistas.has(norm(t)) || parecida(t, pal)) continue
        vistas.add(norm(t)); pal.push(palabras(t)); reglas++
        await sb.from('bot_aprendizajes').insert({ regla: t, categoria: ['estilo', 'conocimiento', 'politica'].includes(r.tipo) ? r.tipo : 'estilo', evidencia: 'Aprendido de cómo respondió el equipo' + (cfg.aprendizaje_auto === 'si' ? ' · activada automáticamente' : ''), origen_telefono: s.telefono, ...estadoNuevo(cfg) })
      }
      await sb.from('chats_revision').upsert({ telefono: s.telefono, sesion_inicio: s.inicio, equipo_revisado_en: new Date().toISOString() }, { onConflict: 'telefono,sesion_inicio' })
      revisadas++
    } catch (e) { console.error('aprenderDelEquipo', e) }
  }
  return { revisadas, reglas }
}
