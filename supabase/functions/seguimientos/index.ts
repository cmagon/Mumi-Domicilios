// Recordatorios automáticos: si el cliente dejó algo pendiente (comprobante, dirección, confirmación…) y no responde,
// el bot insiste de forma natural hasta 2 veces, solo en horario diurno y dentro de la ventana de 24 h de WhatsApp.
// Se invoca por cron (Supabase → Integrations → Cron) cada 10 min con el header x-cron-secret.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { chat, compactar } from '../whatsapp-webhook/ai.ts'
import { construirProveedor } from '../whatsapp-webhook/config.ts'
import { registrarAlerta } from '../whatsapp-webhook/alerts.ts'
import { sendText } from '../whatsapp-webhook/wa.ts'
import { TZ } from '../whatsapp-webhook/tools.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('NOTIFY_WEBHOOK_SECRET')) return new Response('forbidden', { status: 403 })
  const { data: c } = await sb.from('config').select('clave,valor')
  const cfg = Object.fromEntries((c ?? []).map((r) => [r.clave, r.valor])) as Record<string, string>
  if (cfg.seguimiento_activo === 'no') return new Response('desactivado')

  const hora = Number(new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false })) % 24
  const ini = Number(cfg.horario_inicio || 7), fin = Number(cfg.horario_fin || 20)
  if (hora < ini || hora >= fin) return new Response('fuera de horario')

  const esperas = [Number(cfg.seguimiento_1_min || 45), Number(cfg.seguimiento_2_min || 360)]
  const ventana = new Date(Date.now() - 23 * 3600 * 1000).toISOString()
  const { data: convs } = await sb.from('conversaciones').select('telefono,esperando,esperando_desde,seguimientos')
    .not('esperando', 'is', null).eq('humano', false).lt('seguimientos', 2).gte('ultimo_cliente_en', ventana)

  let enviados = 0
  for (const cv of convs ?? []) {
    const n = cv.seguimientos as number
    if (Date.now() - new Date(cv.esperando_desde).getTime() < esperas[n] * 60000) continue
    // Reclama el seguimiento para no duplicarlo si dos ejecuciones se cruzan
    const { data: reclamado } = await sb.from('conversaciones').update({ seguimientos: n + 1 })
      .eq('telefono', cv.telefono).eq('seguimientos', n).not('esperando', 'is', null).select('telefono').maybeSingle()
    if (!reclamado) continue
    try {
      const prov = await construirProveedor(sb, cfg)
      const { data: hist } = await sb.from('mensajes').select('rol,contenido').eq('telefono', cv.telefono).order('creado_en', { ascending: false }).limit(12)
      const history = compactar((hist ?? []).reverse())
      history.push({ role: 'user', content: `[Sistema — este mensaje no lo escribió el cliente] El cliente lleva ${n === 0 ? 'un rato' : 'varias horas'} sin responder. ` +
        `Pendiente: ${cv.esperando}. Escribe UN solo recordatorio breve, cálido y natural (máx. 2 frases), que retome lo pendiente sin presionar y sin repetir todo el resumen. ` +
        (n === 1 ? 'Es el último recordatorio: sé aún más breve y deja la puerta abierta ("cuando quieras me avisas").' : '')})
      const texto = await chat(prov, `${cfg.system_prompt}\n\nNo uses herramientas ni marcadores; responde solo con el texto del recordatorio.`, history, [], async () => ({}))
      if (!texto) continue
      await sendText(cv.telefono, texto)
      await sb.from('mensajes').insert({ telefono: cv.telefono, rol: 'assistant', contenido: texto })
      enviados++
    } catch (e) {
      await sb.from('conversaciones').update({ seguimientos: n }).eq('telefono', cv.telefono) // reintenta en la próxima ejecución
      await registrarAlerta(sb, cfg, 'error', `Seguimiento: ${e}`)
    }
  }
  return new Response(`ok ${enviados}`)
})
