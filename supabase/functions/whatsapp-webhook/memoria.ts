// Memoria del cliente: antes de responder, el bot revisa las conversaciones y pedidos anteriores de ese cliente.
// El resumen de las conversaciones anteriores lo genera la IA una vez y se guarda (se rehace solo si hubo mensajes nuevos antes de la sesión actual).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { chat, type Provider } from './ai.ts'

const SISTEMA = `Resume en español, para que el bot de ventas de Mumi (galletas por WhatsApp) tenga memoria de este cliente. Máx. 450 caracteres, en tercera persona, sin datos de pago ni números de cuenta. Incluye solo lo útil: cómo prefiere que le hablen, sabores o cantidades que le gustan, preferencias de entrega (domicilio o recoger, franja), problemas u objeciones que tuvo y qué quedó pendiente. Si no hay nada útil responde exactamente: SIN_DATOS`

const fmt = (iso: string) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' })

export async function memoriaCliente(sb: SupabaseClient, prov: Provider, telefono: string): Promise<string> {
  // La sesión actual empieza en `inicio`; la memoria son las conversaciones anteriores a ella
  const { data: ses } = await sb.from('chat_sesiones').select('inicio').eq('telefono', telefono).order('inicio', { ascending: false }).limit(1).maybeSingle()
  const inicio: string = ses?.inicio ?? new Date().toISOString()
  const { data: prev } = await sb.from('mensajes').select('creado_en').eq('telefono', telefono).lt('creado_en', inicio).order('creado_en', { ascending: false }).limit(1).maybeSingle()
  const { data: peds } = await sb.from('pedidos').select('numero,creado_en,total,metodo_pago,modalidad,direccion,cliente_nombre,estado,pedido_items(cantidad,productos(nombre))')
    .or(`chat_telefono.eq.${telefono},cliente_telefono.eq.${telefono}`).neq('estado', 'cancelado').order('creado_en', { ascending: false }).limit(5)
  // El resumen guardado sirve aunque ya se hayan borrado los chats viejos (retención de 90 días)
  const { data: memo } = await sb.from('clientes_memoria').select('resumen,hasta').eq('telefono', telefono).maybeSingle()
  if (!prev && !(peds ?? []).length && !memo?.resumen) return ''

  let resumen = memo?.resumen ?? ''
  if (prev) {
    if (!memo || new Date(memo.hasta).getTime() < new Date(prev.creado_en).getTime()) {
      try {
        const { data: msgs } = await sb.from('mensajes').select('rol,contenido').eq('telefono', telefono).lt('creado_en', inicio).order('creado_en', { ascending: false }).limit(60)
        const texto = (msgs ?? []).reverse().map((m) => `${m.rol === 'user' ? 'Cliente' : m.rol === 'admin' ? 'Equipo' : 'Bot'}: ${String(m.contenido).slice(0, 250)}`).join('\n')
        const out = (await chat(prov, SISTEMA, [{ role: 'user', content: `${memo?.resumen ? `Resumen anterior: ${memo.resumen}\n\n` : ''}Conversación:\n${texto}` }], [], async () => ({}))).trim()
        resumen = out.includes('SIN_DATOS') ? '' : out.slice(0, 600)
        await sb.from('clientes_memoria').upsert({ telefono, resumen, hasta: prev.creado_en, actualizado_en: new Date().toISOString() }, { onConflict: 'telefono' })
      } catch (e) { console.error('memoria', e) }
    }
  }

  const lineas: string[] = []
  const ps = peds ?? []
  if (ps.length) {
    lineas.push(`Pedidos anteriores (${ps.length} recientes): ` + ps.map((p: any) =>
      `#${p.numero} (${fmt(p.creado_en)}): ${(p.pedido_items ?? []).map((i: any) => `${i.cantidad} ${i.productos?.nombre}`).join(', ')} — $${p.total}, ${p.modalidad}${p.direccion ? ' en ' + p.direccion : ''}, pago ${p.metodo_pago ?? '?'}`).join(' | '))
    lineas.push(`Nombre con el que pidió: ${ps[0].cliente_nombre}.`)
  }
  if (resumen) lineas.push(`Resumen de sus conversaciones anteriores: ${resumen}`)
  if (!lineas.length) return ''
  return `[Memoria del cliente — ya ha hablado o pedido antes]\n${lineas.join('\n')}\nÚsala para dar continuidad natural (saludarlo por su nombre, recordar sabores que le gustaron, ofrecer repetir su pedido anterior) sin parecer invasivo ni decir que "analizaste" nada. Confirma dirección, pago y fecha en cada pedido nuevo: no los asumas.`
}
