// Avisos temporales para el bot: eventos (feria, mercado…) e instrucciones con fecha. Se crean desde el micrositio o por WhatsApp del admin.
// Dejan de mencionarse solos cuando pasa su fecha (y hora, si la tienen).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { chat } from './ai.ts'
import { construirProveedor } from './config.ts'
import { sendText } from './wa.ts'

export type Aviso = { id: string; tipo: string; texto: string; fecha_desde: string | null; fecha_hasta: string | null; hora_desde: string | null; hora_hasta: string | null; bloquea_entregas: boolean; creado_en: string }
const TZ = 'America/Bogota'
const hoyBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
const ahoraMin = () => { const p = new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).split(':'); return (+p[0] % 24) * 60 + +p[1] }
const min = (h: string | null) => { if (!h) return null; const [a, b] = h.split(':').map(Number); return a * 60 + (b || 0) }
const hBonita = (h: string | null) => { if (!h) return ''; const [a, b] = h.split(':').map(Number); return `${a % 12 || 12}${b ? ':' + String(b).padStart(2, '0') : ''} ${a >= 12 ? 'p. m.' : 'a. m.'}` }
const fBonita = (f: string) => new Date(f + 'T12:00:00Z').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

// Avisos vigentes: no han vencido (fecha y hora de fin) y, si son eventos, empiezan en los próximos `dias` días
export async function avisosVigentes(sb: SupabaseClient, dias = 21): Promise<Aviso[]> {
  const { data } = await sb.from('bot_avisos').select('*').eq('estado', 'activo').order('fecha_desde', { ascending: true, nullsFirst: true })
  const hoy = hoyBogota(), tope = new Date(Date.now() + dias * 86400000).toLocaleDateString('en-CA', { timeZone: TZ })
  return ((data ?? []) as Aviso[]).filter((a) => {
    if (a.fecha_hasta && a.fecha_hasta < hoy) return false
    if (a.fecha_hasta === hoy && a.hora_hasta && (min(a.hora_hasta) as number) < ahoraMin()) return false
    if (a.tipo === 'evento' && a.fecha_desde && a.fecha_desde > tope) return false
    return true
  })
}

export function describir(a: Aviso): string {
  const cuando = a.fecha_desde ? `${fBonita(a.fecha_desde)}${a.fecha_hasta && a.fecha_hasta !== a.fecha_desde ? ' al ' + fBonita(a.fecha_hasta) : ''}${a.hora_desde ? ` de ${hBonita(a.hora_desde)}${a.hora_hasta ? ' a ' + hBonita(a.hora_hasta) : ''}` : ''}` : ''
  return `${a.tipo === 'evento' ? 'EVENTO' : 'INSTRUCCIÓN'}${cuando ? ' (' + cuando + ')' : ''}: ${a.texto}${a.bloquea_entregas ? ' — ese día NO hay entregas' : ''}`
}

// Texto para el contexto del bot
export async function contextoAvisos(sb: SupabaseClient): Promise<string> {
  const l = await avisosVigentes(sb)
  if (!l.length) return ''
  return `\n\n[Avisos temporales del equipo — vigentes; menciónalos solo cuando venga al caso (si preguntan por esas fechas o por dónde encontrarnos, o si afectan una entrega) y nunca los repitas innecesariamente]\n${l.map((a) => '- ' + describir(a)).join('\n')}`
}

// Fechas cerradas (sin entregas) por eventos que bloquean entregas
export async function bloqueosPorEventos(sb: SupabaseClient): Promise<Map<string, string | null>> {
  const m = new Map<string, string | null>()
  const { data } = await sb.from('bot_avisos').select('texto,fecha_desde,fecha_hasta').eq('estado', 'activo').eq('bloquea_entregas', true).gte('fecha_hasta', hoyBogota())
  for (const a of data ?? []) {
    if (!a.fecha_desde) continue
    for (let i = 0; i < 31; i++) {
      const f = new Date(new Date(a.fecha_desde + 'T12:00:00Z').getTime() + i * 86400000).toISOString().slice(0, 10)
      if (f > (a.fecha_hasta ?? a.fecha_desde)) break
      m.set(f, a.texto)
    }
  }
  return m
}

const SISTEMA = `Eres el asistente del equipo de Mumi (galletas por WhatsApp). Un administrador te dicta un EVENTO (feria, mercado, descanso, cierre) o una INSTRUCCIÓN temporal para el bot de ventas. Extrae los datos y responde SOLO un JSON:
{"tipo":"evento"|"instruccion","texto":"mensaje claro y completo para que el bot lo use con los clientes (lugar, horario, qué pueden hacer)","fecha_desde":"YYYY-MM-DD"|null,"fecha_hasta":"YYYY-MM-DD"|null,"hora_desde":"HH:MM"|null,"hora_hasta":"HH:MM"|null,"bloquea_entregas":true|false,"completo":true|false,"pregunta":"una sola pregunta corta con TODO lo que falta"|null}
Reglas: un evento necesita fecha; pregunta también la hora de inicio y fin, el lugar y si ese día hay entregas/domicilios (bloquea_entregas) cuando no los dijo. Una instrucción puede no tener fecha (queda vigente hasta que la quiten) pero pregunta hasta cuándo aplica si no lo dijo. Si el administrador ya respondió lo que faltaba o dijo "así está bien", completo=true. Interpreta fechas relativas con la fecha de hoy que te doy.`

async function parsear(sb: SupabaseClient, cfg: Record<string, string>, crudo: string): Promise<any> {
  const prov = await construirProveedor(sb, cfg)
  const hoy = hoyBogota()
  const out = await chat(prov, SISTEMA, [{ role: 'user', content: `Hoy es ${hoy} (${new Date(hoy + 'T12:00:00Z').toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'UTC' })}).\nLo que ha dicho el administrador (en orden):\n${crudo}` }], [], async () => ({}))
  const j = out.match(/\{[\s\S]*\}/)
  if (!j) throw new Error('respuesta sin JSON')
  return JSON.parse(j[0])
}

// Comandos del administrador por WhatsApp. Devuelve true si el mensaje se manejó aquí.
export async function comandoAviso(sb: SupabaseClient, cfg: Record<string, string>, from: string, texto: string): Promise<boolean> {
  const t = texto.trim()
  const inicia = t.match(/^(evento|aviso|instrucci[oó]n(?:\s+temporal)?)\s*:\s*([\s\S]+)$/i)

  if (/^avisos$/i.test(t)) {
    const l = await avisosVigentes(sb, 365)
    await sendText(from, l.length ? `Avisos vigentes:\n${l.map((a, i) => `${i + 1}. ${describir(a)}`).join('\n')}\n\nPara quitar uno: "quitar aviso 2"` : 'No hay avisos vigentes. Para crear uno escribe "evento: …" o "instrucción: …"')
    return true
  }
  const q = t.match(/^quitar aviso\s+(\d+)/i)
  if (q) {
    const l = await avisosVigentes(sb, 365); const a = l[Number(q[1]) - 1]
    if (!a) { await sendText(from, 'No encontré ese número. Escribe "avisos" para ver la lista.'); return true }
    await sb.from('bot_avisos').update({ estado: 'quitado' }).eq('id', a.id)
    await sendText(from, `Quité el aviso: ${describir(a)}`); return true
  }

  const { data: borrador } = await sb.from('bot_avisos').select('id,texto_crudo,creado_en').eq('estado', 'borrador').eq('admin_telefono', from).order('creado_en', { ascending: false }).limit(1).maybeSingle()
  const vigente = borrador && Date.now() - new Date(borrador.creado_en).getTime() < 30 * 60000
  if (/^cancelar(\s+aviso)?$/i.test(t) && vigente) { await sb.from('bot_avisos').update({ estado: 'quitado' }).eq('id', borrador!.id); await sendText(from, 'Listo, cancelé ese aviso.'); return true }
  if (!inicia && !vigente) return false

  let id = vigente && !inicia ? borrador!.id : null
  let crudo = inicia ? inicia[2] : `${borrador!.texto_crudo}\n${t}`
  if (inicia && vigente) await sb.from('bot_avisos').update({ estado: 'quitado' }).eq('id', borrador!.id) // un aviso nuevo reemplaza al borrador anterior
  try {
    const r = await parsear(sb, cfg, crudo)
    const fila = { tipo: r.tipo === 'instruccion' ? 'instruccion' : 'evento', texto: String(r.texto ?? crudo).slice(0, 500), fecha_desde: r.fecha_desde ?? null, fecha_hasta: r.fecha_hasta ?? r.fecha_desde ?? null,
      hora_desde: r.hora_desde ?? null, hora_hasta: r.hora_hasta ?? null, bloquea_entregas: !!r.bloquea_entregas, texto_crudo: crudo, admin_telefono: from }
    const completo = !!r.completo && (fila.tipo !== 'evento' || !!fila.fecha_desde)
    if (!completo) {
      if (id) await sb.from('bot_avisos').update({ ...fila, estado: 'borrador' }).eq('id', id); else await sb.from('bot_avisos').insert({ ...fila, estado: 'borrador' })
      await sendText(from, `${r.pregunta ?? '¿Me das la fecha y los detalles que faltan?'}\n\n(Responde aquí mismo; "cancelar" para descartar)`)
      return true
    }
    if (id) await sb.from('bot_avisos').update({ ...fila, estado: 'activo' }).eq('id', id); else await sb.from('bot_avisos').insert({ ...fila, estado: 'activo' })
    await sendText(from, `✅ Guardado. El bot lo tendrá en cuenta${fila.fecha_hasta ? ' y dejará de mencionarlo cuando pase la fecha' : ' hasta que lo quites'}:\n${describir({ ...fila, id: '', creado_en: '' } as Aviso)}\n\nEscribe "avisos" para ver la lista o "quitar aviso N" para retirarlo.`)
  } catch (e) {
    console.error('comandoAviso', e)
    await sendText(from, 'No pude interpretar el aviso 🙈 ¿Me lo escribes con fecha y horario? Ej.: "evento: domingo 4 de octubre mercado campesino de 8 a 2, sin domicilios"')
  }
  return true
}
