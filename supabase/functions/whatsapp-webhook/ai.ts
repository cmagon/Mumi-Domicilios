// Abstracción Claude / OpenAI / Gemini con function calling
export type Tool = { name: string; description: string; parameters: Record<string, unknown> }
export type Turn = { role: 'user' | 'assistant'; content: string }
export type Proveedor = 'claude' | 'openai' | 'gemini'
export type Provider = { proveedor: Proveedor; apiKey: string; modelo: string }

// Une turnos consecutivos del mismo rol (el bot envía varios mensajes cortos seguidos)
export function compactar(filas: { rol: string; contenido: string }[]): Turn[] {
  const out: Turn[] = []
  for (const m of filas) {
    const role = m.rol === 'assistant' ? 'assistant' : 'user'
    const last = out[out.length - 1]
    if (last && last.role === role) last.content += '\n' + m.contenido
    else out.push({ role, content: m.contenido })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

export const modeloPorDefecto = (p: string) =>
  p === 'openai' ? 'gpt-5.4-mini' : p === 'gemini' ? 'gemini-2.5-flash' : 'claude-haiku-4-5-20251001'

export async function chat(
  prov: Provider, system: string, history: Turn[], tools: Tool[],
  run: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): Promise<string> {
  if (prov.proveedor === 'openai') return openaiLoop(prov, system, history, tools, run)
  if (prov.proveedor === 'gemini') return geminiLoop(prov, system, history, tools, run)
  return claudeLoop(prov, system, history, tools, run)
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
        ...(tools.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}), messages }),
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
        ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}) }),
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


// ---------- Gemini (API nativa generateContent) ----------
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models'
// Gemini espera tipos en mayúscula (OBJECT, STRING…)
// deno-lint-ignore no-explicit-any
const geminiSchema = (n: any): any => Array.isArray(n) ? n.map(geminiSchema)
  : n && typeof n === 'object' ? Object.fromEntries(Object.entries(n).map(([k, v]) => [k, k === 'type' && typeof v === 'string' ? v.toUpperCase() : geminiSchema(v)])) : n

async function geminiCall(prov: Provider, body: unknown) {
  const r = await fetch(`${GEMINI}/${prov.modelo}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': prov.apiKey, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 400)}`)
  return await r.json()
}

async function geminiLoop(prov: Provider, system: string, history: Turn[], tools: Tool[],
  run: (n: string, a: Record<string, unknown>) => Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const contents: any[] = history.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.content }] }))
  const functionDeclarations = tools.map((t) => {
    const props = (t.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    return { name: t.name, description: t.description, ...(Object.keys(props).length ? { parameters: geminiSchema(t.parameters) } : {}) }
  })
  for (let i = 0; i < 8; i++) {
    const data = await geminiCall(prov, { systemInstruction: { parts: [{ text: system }] }, contents, ...(functionDeclarations.length ? { tools: [{ functionDeclarations }] } : {}) })
    const cand = data.candidates?.[0]
    if (!cand?.content) throw new Error(`Gemini sin respuesta (${cand?.finishReason ?? data.promptFeedback?.blockReason ?? 'desconocido'})`)
    const parts = cand.content.parts ?? []
    // deno-lint-ignore no-explicit-any
    const calls = parts.filter((p: any) => p.functionCall)
    if (!calls.length) {
      // deno-lint-ignore no-explicit-any
      return parts.map((p: any) => p.text ?? '').join('').trim()
    }
    contents.push(cand.content) // conserva las firmas de razonamiento (thoughtSignature)
    const responses = []
    for (const p of calls) {
      let out: unknown
      try { out = await run(p.functionCall.name, p.functionCall.args ?? {}) } catch (e) { out = { error: String(e) } }
      responses.push({ functionResponse: { name: p.functionCall.name, response: { result: out } } })
    }
    contents.push({ role: 'user', parts: responses })
  }
  return 'Dame un momento, ya te confirmo.'
}

// Prueba mínima sin herramientas (botón "Probar IA")
export async function ping(prov: Provider): Promise<string> {
  return await chat(prov, 'Responde únicamente con la palabra OK.', [{ role: 'user', content: 'ping' }], [], async () => ({}))
}

// Visión: lee un comprobante y devuelve JSON { monto, referencia, legible }
export async function leerComprobante(prov: Provider, bytes: Uint8Array, mime: string) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const b64 = btoa(bin)
  const prompt = 'Esta imagen es un comprobante de pago (Nequi/Bre-B/transferencia). Responde SOLO un JSON: ' +
    '{"legible": boolean, "monto": número en pesos sin separadores o null, "referencia": string o null}.'
  let text: string
  if (prov.proveedor === 'gemini') {
    const d = await geminiCall(prov, { contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: b64 } }, { text: prompt }] }] })
    // deno-lint-ignore no-explicit-any
    text = (d.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('')
  } else if (prov.proveedor === 'openai') {
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

// Transcripción de notas de voz: motor 'gemini' u 'openai' (Whisper)
export async function transcribir(motor: 'gemini' | 'openai', apiKey: string, bytes: Uint8Array, mime: string, modeloGemini = 'gemini-2.5-flash'): Promise<string> {
  const limpio = mime.split(';')[0].trim() || 'audio/ogg'
  if (motor === 'gemini') {
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const d = await geminiCall({ proveedor: 'gemini', apiKey, modelo: modeloGemini }, { contents: [{ role: 'user', parts: [
      { inlineData: { mimeType: limpio, data: btoa(bin) } },
      { text: 'Transcribe literalmente en español este audio de WhatsApp. Responde solo con la transcripción, sin comentarios.' }] }] })
    // deno-lint-ignore no-explicit-any
    const t = (d.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('').trim()
    if (!t) throw new Error('Gemini no devolvió transcripción')
    return t
  }
  const fd = new FormData()
  fd.append('file', new Blob([bytes], { type: limpio }), 'audio.ogg')
  fd.append('model', 'whisper-1')
  fd.append('language', 'es')
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: fd })
  if (!r.ok) throw new Error(`Whisper ${r.status}: ${(await r.text()).slice(0, 300)}`)
  return (await r.json()).text
}
