// Recordatorios automáticos: si el cliente dejó algo pendiente (comprobante, dirección, confirmación…) y no responde,
// el bot insiste de forma natural hasta 2 veces, solo en horario diurno y dentro de la ventana de 24 h de WhatsApp.
// Se invoca por cron (Supabase → Integrations → Cron) cada 10 min con el header x-cron-secret.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { chat, compactar } from '../whatsapp-webhook/ai.ts'
import { construirProveedor } from '../whatsapp-webhook/config.ts'
import { registrarAlerta } from '../whatsapp-webhook/alerts.ts'
import { sendText } from '../whatsapp-webhook/wa.ts'
import { TZ } from '../whatsapp-webhook/tools.ts'
import { humanoTardo } from '../whatsapp-webhook/humano.ts'
import { analizarSesiones, aprenderDeSesiones } from '../whatsapp-webhook/analisis.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (req) => {
  const secreto = Deno.env.get('NOTIFY_WEBHOOK_SECRET')
  if (!secreto) return new Response('Falta crear el secret NOTIFY_WEBHOOK_SECRET en Supabase (Edge Functions → Secrets)', { status: 500 })
  const enviado = req.headers.get('x-cron-secret')
  if (!enviado) return new Response('Falta el header x-cron-secret en el trabajo programado', { status: 403 })
  if (enviado !== secreto) return new Response('El header x-cron-secret no coincide con el secret NOTIFY_WEBHOOK_SECRET', { status: 403 })
  const { data: c } = await sb.from('config').select('clave,valor')
  const cfg = Object.fromEntries((c ?? []).map((r) => [r.clave, r.valor])) as Record<string, string>
  // 1) Chats atendidos por una persona que tardó en responder: el bot los retoma (lo hace el webhook)
  const { data: humanos } = await sb.from('conversaciones').select('telefono,humano_desde').eq('humano', true)
  let retomados = 0
  for (const h of humanos ?? []) {
    if (!(await humanoTardo(sb, cfg, h.telefono, h.humano_desde))) continue
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-webhook`, { method: 'POST', headers: { 'x-cron-secret': secreto, 'content-type': 'application/json' }, body: JSON.stringify({ reanudar: h.telefono }) }).catch(() => null)
    retomados++
  }
  // 2) Aprovecha la ejecución del cron para analizar y aprender de unas pocas conversaciones (solo unas veces por hora, aunque el cron corra cada minuto)
  if (new Date().getMinutes() % 10 < 2) {
    await analizarSesiones(sb, cfg, 3).catch(() => 0)
    await aprenderDeSesiones(sb, cfg, 2).catch(() => 0)
  }

  if (cfg.seguimiento_activo === 'no') return new Response('desactivado')

  const hora = Number(new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false })) % 24
  const ini = Number(cfg.horario_inicio || 7), fin = Number(cfg.horario_fin || 20)
  if (hora < ini || hora >= fin) return new Response('fuera de horario')

  const esperas = [Number(cfg.seguimiento_1_min || 10), Number(cfg.seguimiento_2_min || 360)]
  const ventana = new Date(Date.now() - 23 * 3600 * 1000).toISOString()
  const { data: convs } = await sb.from('conversaciones').select('telefono,esperando,esperando_desde,seguimientos')
    .not('esperando', 'is', null).eq('humano', false).lt('seguimientos', 2).gte('esperando_desde', ventana)

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
        `Pendiente: ${cv.esperando}. Retoma la conversación donde quedó con el objetivo de cerrar la venta: escribe UN solo mensaje breve, cálido y natural (máx. 2 frases) que recuerde lo último que hablaron y proponga el siguiente paso concreto, sin presionar, sin repetir todo el resumen y sin inventar urgencia ni descuentos. ` +
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
  console.log('seguimientos: candidatos', convs?.length ?? 0, 'enviados', enviados)
  return new Response(`ok: ${convs?.length ?? 0} candidatos, ${enviados} recordatorios enviados`)
})
