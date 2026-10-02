// Retención de chats: pasados N días (por defecto 90) se borran los mensajes viejos de cada chat y solo queda un resumen
// (clientes_memoria) por si el cliente vuelve después. Los pedidos, comprobantes ligados a pedidos y datos del cliente NO se tocan.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { chat } from './ai.ts'
import { construirProveedor, numerosEquipo } from './config.ts'

const SISTEMA = `Resume en español, para que el bot de ventas de Mumi (galletas por WhatsApp) recuerde a este cliente aunque se borre el historial de chat. Máx. 600 caracteres, en tercera persona, sin datos de pago, números de cuenta ni teléfonos. Incorpora lo útil del "Resumen anterior" (si existe) con lo nuevo: cómo prefiere comprar (sabores que le gustaron, cantidades, domicilio o recoger, barrio/zona), cómo trata (formal o cercano), quejas o acuerdos con el equipo y cualquier dato que ayude a atenderlo mejor si vuelve. Si no hay nada útil responde exactamente SIN_DATOS.`

// Procesa un lote de chats con mensajes viejos. Devuelve cuántos chats depuró.
export async function depurarChats(sb: SupabaseClient, cfg: Record<string, string>, maxChats = 5): Promise<number> {
  const dias = cfg.retencion_chat_dias === '' || cfg.retencion_chat_dias == null ? 90 : Number(cfg.retencion_chat_dias)
  if (!(dias > 0)) return 0 // 0 = no borrar nunca
  const corte = new Date(Date.now() - dias * 86400000).toISOString()
  const { data: viejos } = await sb.from('mensajes').select('telefono').lt('creado_en', corte).order('creado_en', { ascending: true }).limit(400)
  const telefonos = [...new Set((viejos ?? []).map((m) => m.telefono as string))].slice(0, maxChats)
  if (!telefonos.length) { await limpiarAvisos(sb, corte); return 0 }
  const equipo = new Set(numerosEquipo(cfg))
  let prov: Awaited<ReturnType<typeof construirProveedor>> | null = null
  let hechos = 0
  for (const tel of telefonos) {
    const { data: msgs } = await sb.from('mensajes').select('id,rol,contenido,media_path,creado_en').eq('telefono', tel).lt('creado_en', corte).order('creado_en', { ascending: true }).limit(300)
    if (!msgs?.length) continue
    try {
      // 1) Resumen (no para el equipo). Si la IA falla, NO se borra: se reintenta en la próxima ejecución.
      if (!equipo.has(tel)) {
        const conv = msgs.filter((m) => !/^\[.*\]$/.test(String(m.contenido).trim()) && m.contenido !== '…')
        if (conv.length >= 2) {
          const { data: memo } = await sb.from('clientes_memoria').select('resumen,hasta').eq('telefono', tel).maybeSingle()
          prov ??= await construirProveedor(sb, cfg)
          const texto = conv.map((m) => `${m.rol === 'user' ? 'Cliente' : m.rol === 'admin' ? 'Equipo' : 'Bot'}: ${String(m.contenido).slice(0, 250)}`).join('\n').slice(-9000)
          const out = (await chat(prov, SISTEMA, [{ role: 'user', content: `${memo?.resumen ? `Resumen anterior: ${memo.resumen}\n\n` : ''}Conversación (más antigua):\n${texto}` }], [], async () => ({}))).trim()
          const resumen = out.includes('SIN_DATOS') ? (memo?.resumen ?? '') : out.slice(0, 700)
          const hasta = msgs[msgs.length - 1].creado_en
          await sb.from('clientes_memoria').upsert({ telefono: tel, resumen, hasta: memo?.hasta && memo.hasta > hasta ? memo.hasta : hasta, actualizado_en: new Date().toISOString() }, { onConflict: 'telefono' })
        }
      }
      // 2) Archivos de esos mensajes que no estén ligados a un pedido o aviso
      const rutas = [...new Set(msgs.map((m) => m.media_path as string | null).filter(Boolean))] as string[]
      if (rutas.length) {
        const [{ data: p }, { data: n }] = await Promise.all([
          sb.from('pedidos').select('comprobante_url').in('comprobante_url', rutas),
          sb.from('notificaciones').select('media_path').in('media_path', rutas).eq('leida', false)])
        const protegidas = new Set([...(p ?? []).map((x) => x.comprobante_url), ...(n ?? []).map((x) => x.media_path)])
        const borrar = rutas.filter((r) => !protegidas.has(r))
        if (borrar.length) await sb.storage.from('comprobantes').remove(borrar)
      }
      // 3) Se borran los mensajes
      await sb.from('mensajes').delete().in('id', msgs.map((m) => m.id))
      hechos++
    } catch (e) { console.error('depurarChats', tel, e) }
  }
  return hechos
}

async function limpiarAvisos(sb: SupabaseClient, corte: string) {
  await sb.from('notificaciones').delete().eq('leida', true).lt('creado_en', corte)
}
