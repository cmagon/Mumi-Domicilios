// Casos: avisos de chats que necesitan al admin. Cada uno tiene un número (#12). El admin responde por WhatsApp con "12: mensaje" (sin IA, instantáneo),
// citando el aviso, o pidiéndoselo al asistente. Aquí están los helpers y el comando rápido.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { sendText } from './wa.ts'

export async function ventanaCliente(sb: SupabaseClient, tel: string) {
  const { data } = await sb.from('mensajes').select('creado_en').eq('telefono', tel).eq('rol', 'user').order('creado_en', { ascending: false }).limit(1).maybeSingle()
  return !!data && Date.now() - new Date(data.creado_en).getTime() < 23.5 * 3600 * 1000
}

// Respuesta enviada al cliente por orden del admin: queda en su chat como mensaje del bot, se cierran los avisos de atención y el bot sigue atendiendo
export async function despuesDeResponder(sb: SupabaseClient, tel: string, contenido: string, waId: string) {
  await sb.from('mensajes').insert({ telefono: tel, rol: 'assistant', contenido, wa_id: waId })
  await sb.from('conversaciones').upsert({ telefono: tel, humano: false, humano_desde: null, actualizado_en: new Date().toISOString() }, { onConflict: 'telefono' })
  await sb.from('notificaciones').update({ leida: true }).eq('telefono', tel).eq('leida', false).in('tipo', ['atencion', 'sin_respuesta', 'pedido_grande'])
}

export async function chatDeCaso(sb: SupabaseClient, caso: number): Promise<{ telefono: string; nombre: string | null; titulo: string } | null> {
  const { data } = await sb.from('notificaciones').select('telefono,titulo').eq('caso', caso).not('telefono', 'is', null).maybeSingle()
  if (!data?.telefono) return null
  const { data: cv } = await sb.from('conversaciones').select('nombre_wa').eq('telefono', data.telefono).maybeSingle()
  return { telefono: data.telefono, nombre: cv?.nombre_wa ?? null, titulo: data.titulo }
}

// Casos abiertos (avisos de chat sin atender, un caso por cliente: el más reciente)
export async function casosAbiertos(sb: SupabaseClient, max = 10) {
  const { data } = await sb.from('notificaciones').select('caso,telefono,titulo,detalle,creado_en').eq('leida', false).not('telefono', 'is', null)
    .gte('creado_en', new Date(Date.now() - 48 * 3600 * 1000).toISOString()).order('creado_en', { ascending: false }).limit(60)
  const vistos = new Set<string>(); const out: { caso: number; telefono: string; titulo: string; detalle: string | null }[] = []
  for (const n of data ?? []) { if (vistos.has(n.telefono)) continue; vistos.add(n.telefono); out.push({ caso: Number(n.caso), telefono: n.telefono, titulo: n.titulo, detalle: n.detalle }) }
  return out.slice(0, max)
}

// Comandos rápidos (sin IA): "12: texto" responde al caso 12 · "cerrar 12" / "cerrar todos" · "casos" lista los abiertos
export async function comandoCasos(sb: SupabaseClient, from: string, texto: string): Promise<boolean> {
  const t = texto.trim()
  const r = t.match(/^(?:caso\s*)?#?(\d{1,7})\s*[:>\-–]\s*([\s\S]+)$/i)
  if (r) {
    const c = await chatDeCaso(sb, Number(r[1]))
    if (!c) { await sendText(from, `No encontré el caso #${r[1]}. Escribe "casos" para ver los abiertos.`); return true }
    if (!(await ventanaCliente(sb, c.telefono))) { await sendText(from, `El caso #${r[1]} (${c.nombre ?? c.telefono}) lleva más de 24 h sin escribir: WhatsApp no permite enviarle mensajes libres.`); return true }
    const id = await sendText(c.telefono, r[2].trim())
    if (!id) { await sendText(from, 'WhatsApp no aceptó el mensaje 🙈'); return true }
    await despuesDeResponder(sb, c.telefono, r[2].trim(), id)
    await sendText(from, `✅ Enviado a ${c.nombre ?? c.telefono} (caso #${r[1]}). El bot sigue con ese chat.`)
    return true
  }
  const cerr = t.match(/^cerrar\s+(todos|#?\d{1,7})$/i)
  if (cerr) {
    if (/todos/i.test(cerr[1])) { await sb.from('notificaciones').update({ leida: true }).eq('leida', false).not('telefono', 'is', null); await sendText(from, '✅ Cerré todos los casos abiertos.'); return true }
    const c = await chatDeCaso(sb, Number(cerr[1].replace('#', '')))
    if (!c) { await sendText(from, 'No encontré ese caso.'); return true }
    await sb.from('notificaciones').update({ leida: true }).eq('telefono', c.telefono).eq('leida', false)
    await sendText(from, `✅ Cerré el caso de ${c.nombre ?? c.telefono}.`); return true
  }
  if (/^casos$/i.test(t)) {
    const l = await casosAbiertos(sb)
    await sendText(from, l.length ? `📋 Casos abiertos:\n${l.map((x) => `#${x.caso} ${x.titulo.slice(0, 60)}`).join('\n')}\n\nResponde con "12: tu mensaje" o "cerrar 12".` : 'No hay casos abiertos ✅')
    return true
  }
  return false
}
