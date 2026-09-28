// Abstracción Claude / OpenAI con function calling
export type Tool = { name: string; description: string; parameters: Record<string, unknown> }
export type Turn = { role: 'user' | 'assistant'; content: string }
export type Provider = { proveedor: 'claude' | 'openai'; apiKey: string; modelo: string }

export const modeloPorDefecto = (p: string) => (p === 'openai' ? 'gpt-5.4-mini' : 'claude-haiku-4-5-20251001')

export async function chat(
  prov: Provider, system: string, history: Turn[], tools: Tool[],
  run: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): Promise<string> {
  return prov.proveedor === 'openai' ? openaiLoop(prov, system, history, tools, run) : claudeLoop(prov, system, history, tools, run)
}

async function claudeLoop(prov: Provider, system: string, history: Turn[], tools: Tool[],
  run: (n: string, a: Record<string, unknown>) => Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const messages: any[] = history.map((t) => ({ role: t.role, content: t.content }))
  for (let i = 0; i < 8; i++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': prov.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: prov.modelo, max_tokens: 1024, system,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })), messages }),
    })
    if (!r.ok) throw new Error(`Claude ${r.status}: ${await r.text()}`)
    const data = await r.json()
    if (data.stop_reason !== 'tool_use') {
      return data.content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n').trim()
    }
    messages.push({ role: 'assistant', content: data.content })
    const results = []
    for (const b of data.content.filter((b: { type: string }) => b.type === 'tool_use')) {
      let out: unknown
      try { out = await run(b.name, b.input) } catch (e) { out = { error: String(e) } }
      results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out) })
    }
    messages.push({ role: 'user', content: results })
  }
  return 'Dame un momento, ya te confirmo.'
}

async function openaiLoop(prov: Provider, system: string, history: Turn[], tools: Tool[],
  run: (n: string, a: Record<string, unknown>) => Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const messages: any[] = [{ role: 'system', content: system }, ...history]
  for (let i = 0; i < 8; i++) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${prov.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: prov.modelo, messages,
        tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) }),
    })
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`)
    const msg = (await r.json()).choices[0].message
    if (!msg.tool_calls?.length) return (msg.content ?? '').trim()
    messages.push(msg)
    for (const c of msg.tool_calls) {
      let out: unknown
      try { out = await run(c.function.name, JSON.parse(c.function.arguments || '{}')) } catch (e) { out = { error: String(e) } }
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(out) })
    }
  }
  return 'Dame un momento, ya te confirmo.'
}

// Visión: lee un comprobante y devuelve JSON { monto, referencia, legible }
export async function leerComprobante(prov: Provider, bytes: Uint8Array, mime: string) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const b64 = btoa(bin)
  const prompt = 'Esta imagen es un comprobante de pago (Nequi/Bre-B/transferencia). Responde SOLO un JSON: ' +
    '{"legible": boolean, "monto": número en pesos sin separadores o null, "referencia": string o null}.'
  let text: string
  if (prov.proveedor === 'openai') {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${prov.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: prov.modelo, messages: [{ role: 'user', content: [
        { type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }] }] }),
    })
    if (!r.ok) throw new Error(`OpenAI ${r.status}`)
    text = (await r.json()).choices[0].message.content
  } else {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': prov.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: prov.modelo, max_tokens: 300, messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } }, { type: 'text', text: prompt }] }] }),
    })
    if (!r.ok) throw new Error(`Claude ${r.status}`)
    text = (await r.json()).content[0].text
  }
  const m = text.match(/\{[\s\S]*\}/)
  return m ? JSON.parse(m[0]) as { legible: boolean; monto: number | null; referencia: string | null } : { legible: false, monto: null, referencia: null }
}

// Transcripción de notas de voz (Whisper)
export async function transcribir(apiKey: string, bytes: Uint8Array, mime: string): Promise<string> {
  const fd = new FormData()
  fd.append('file', new Blob([bytes], { type: mime }), 'audio.ogg')
  fd.append('model', 'whisper-1')
  fd.append('language', 'es')
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: fd })
  if (!r.ok) throw new Error(`Whisper ${r.status}`)
  return (await r.json()).text
}
