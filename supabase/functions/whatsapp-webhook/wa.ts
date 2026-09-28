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

export const sendText = (to: string, body: string) => post({ to, type: 'text', text: { body } })
export const sendImage = (to: string, link: string, caption?: string) => post({ to, type: 'image', image: { link, caption } })
export const sendButtons = (to: string, body: string, buttons: { id: string; title: string }[]) =>
  post({ to, type: 'interactive', interactive: { type: 'button', body: { text: body },
    action: { buttons: buttons.map((b) => ({ type: 'reply', reply: b })) } } })

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
