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
