// Prueba de humo del webhook del bot: lo compila, le envía un mensaje firmado de WhatsApp con Supabase, Gemini y WhatsApp simulados,
// y verifica que el cliente recibe respuesta. Detecta errores que la compilación no ve (p. ej. variables usadas antes de declararse).
import { createHmac } from 'node:crypto'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import assert from 'node:assert'
import { DATA, calls } from './fake-supabase.mjs'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(aqui, '.out.mjs')
await build({ entryPoints: [path.join(aqui, '../supabase/functions/whatsapp-webhook/index.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { 'npm:@supabase/supabase-js@2': path.join(aqui, 'fake-supabase.mjs'), 'npm:web-push@3.6.7': path.join(aqui, 'fake-webpush.mjs') }, logLevel: 'error' })

const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', WHATSAPP_APP_SECRET: 'sec', WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: '1', WHATSAPP_VERIFY_TOKEN: 'v' }
let handler; const tareas = []; const enviados = []
let modeloVacio = false
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
globalThis.EdgeRuntime = { waitUntil: (p) => tareas.push(p) }
globalThis.fetch = async (url, init) => {
  const u = String(url)
  if (u.includes('graph.facebook.com')) { enviados.push(JSON.parse(init.body)); return new Response(JSON.stringify({ messages: [{ id: 'wamid.OUT' + enviados.length }] })) }
  if (u.includes('generativelanguage')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: modeloVacio ? '' : 'Hola 😊\n\n¿Cuántas quieres?' }] } }] }))
  return new Response('{}')
}
await import(out)

async function enviar(texto, id, de = '573111') {
  enviados.length = 0
  const body = JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: de, profile: { name: 'Ana' } }], messages: [{ id, from: de, type: 'text', text: { body: texto } }] } }] }] })
  const sig = 'sha256=' + createHmac('sha256', 'sec').update(body).digest('hex')
  const r = await handler(new Request('http://x/', { method: 'POST', headers: { 'x-hub-signature-256': sig }, body }))
  await Promise.all(tareas.splice(0))
  return { status: r.status, textos: enviados.filter((m) => m.type === 'text').map((m) => m.text.body) }
}

// 1) Flujo normal: el cliente escribe y recibe la respuesta del modelo, en mensajes cortos
let r = await enviar('hola quiero una de limon', 'w1')
assert.equal(r.status, 200)
assert.deepEqual(r.textos, ['Hola 😊', '¿Cuántas quieres?'], `respuesta inesperada: ${JSON.stringify(r.textos)}`)

// 1b) Quedó una pregunta abierta: se programa el recordatorio (esperando)
assert.ok(calls.some(([t, k, a]) => t === 'conversaciones' && k === 'upsert' && a.includes('esperando":"que el cliente retome')), 'no se programó el seguimiento tras una pregunta abierta')

// 2) El modelo devuelve vacío: el cliente nunca se queda sin respuesta
modeloVacio = true
r = await enviar('hola', 'w1')
assert.ok(r.textos.some((t) => t.includes('Dame un momento')), `sin mensaje de espera: ${JSON.stringify(r.textos)}`)

// 3) Ráfaga: si el cliente escribe otro mensaje mientras el bot prepara la respuesta, esta se descarta (responde solo el último, una vez)
modeloVacio = false
DATA.mensajes[0] = { rol: 'user', contenido: 'otro mensaje', wa_id: 'w9', creado_en: new Date().toISOString() }
r = await enviar('hola', 'w2')
assert.deepEqual(r.textos, [], `debió descartar la respuesta por mensaje nuevo: ${JSON.stringify(r.textos)}`)

// 4) El número del admin NUNCA es cliente: su mensaje lo atiende el asistente interno (sin errores) y recibe respuesta
modeloVacio = false
r = await enviar('hola', 'wa1', '573000000000')
assert.equal(r.status, 200)
assert.ok(r.textos.length >= 1, `el asistente del admin no respondió: ${JSON.stringify(r.textos)}`)
assert.ok(!r.textos.some((t) => t.includes('Ups') || t.includes('No pude') || t.includes('Dame un momento')), `el asistente del admin falló: ${JSON.stringify(r.textos)}`)
assert.ok(!calls.some(([t, k, a]) => t === 'conversaciones' && k === 'upsert' && a.includes('573000000000') && a.includes('esperando')), 'el admin entró al flujo de clientes')
console.log('✅ Pruebas de humo del bot: OK')
