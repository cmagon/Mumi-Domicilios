// Cliente mínimo de WhatsApp Cloud API
const V = 'v21.0'
const token = () => Deno.env.get('WHATSAPP_TOKEN')!
const phoneId = () => Deno.env.get('WHATSAPP_PHONE_ID')!

async function post(body: unknown) {
  const r = await fetch(`https://graph.facebook.com/${V}/${phoneId()}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...(body as object) }),
  })
  if (!r.ok) console.error('WA send error', r.status, await r.text())
}

// Marca como leído y muestra "escribiendo…" (hasta 25 s o hasta que se envíe una respuesta)
export const marcarLeido = (messageId: string) =>
  post({ status: 'read', message_id: messageId, typing_indicator: { type: 'text' } }).catch(() => {})

export const sendText = (to: string, body: string) => post({ to, type: 'text', text: { body } })
export const sendImage = (to: string, link: string, caption?: string) => post({ to, type: 'image', image: { link, caption } })
export const sendButtons = (to: string, body: string, buttons: { id: string; title: string }[]) =>
  post({ to, type: 'interactive', interactive: { type: 'button', body: { text: body },
    action: { buttons: buttons.map((b) => ({ type: 'reply', reply: b })) } } })

// Plantilla aprobada por Meta (necesaria fuera de la ventana de 24 h). Los botones de respuesta rápida llevan un payload por envío.
export const sendTemplate = (to: string, name: string, params: string[], buttonPayloads: string[] = []) =>
  post({ to, type: 'template', template: { name, language: { code: 'es' }, components: [
    { type: 'body', parameters: params.map((text) => ({ type: 'text', text })) },
    ...buttonPayloads.map((payload, index) => ({ type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload }] })),
  ] } })

// Usa la plantilla si su nombre está configurado (secret); si no, cae a mensaje normal (solo funciona dentro de 24 h).
export async function notify(to: string, o: { templateEnv: string; params: string[]; buttonPayloads?: string[];
  text: string; buttons?: { id: string; title: string }[] }) {
  const tpl = Deno.env.get(o.templateEnv)
  if (tpl) return sendTemplate(to, tpl, o.params, o.buttonPayloads)
  return o.buttons ? sendButtons(to, o.text, o.buttons) : sendText(to, o.text)
}

export async function downloadMedia(id: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const meta = await (await fetch(`https://graph.facebook.com/${V}/${id}`, { headers: { Authorization: `Bearer ${token()}` } })).json()
  const r = await fetch(meta.url, { headers: { Authorization: `Bearer ${token()}` } })
  return { bytes: new Uint8Array(await r.arrayBuffer()), mime: meta.mime_type ?? r.headers.get('content-type') ?? 'application/octet-stream' }
}

export async function verifySignature(raw: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(Deno.env.get('WHATSAPP_APP_SECRET')!),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))
  const hex = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('')
  const given = header.slice(7)
  if (given.length !== hex.length) return false
  let diff = 0
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i)
  return diff === 0
}

export const digits = (s: string) => s.replace(/\D/g, '')
