// Fotos y videos enviados por un administrador: "foto: <sabor>" agrega al sabor existente; "nuevo: Nombre, precio, descripción" crea un sabor (oculto hasta que lo actives).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { downloadMedia, sendText } from './wa.ts'
import { agenteAdmin } from './adminagente.ts'

const sinAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export async function mediaAdmin(sb: SupabaseClient, msg: any, from: string): Promise<boolean> {
  const m = msg.type === 'image' ? msg.image : msg.type === 'video' ? msg.video : msg.type === 'document' ? msg.document : null
  if (!m?.id) return false
  const cap = String(m.caption ?? '').trim().match(/^(foto|imagen|video|nuevo(?:\s+producto|\s+sabor)?)\s*:\s*([\s\S]+)$/i)
  if (!cap) {
    // Sin prefijo: se guarda como material pendiente y el asistente decide con lo que dijo el admin (guardarlo con contexto, ponerlo a un producto o enviárselo a un cliente)
    try {
      const { bytes, mime } = await downloadMedia(m.id)
      const video = mime.startsWith('video/')
      if (!video && !mime.startsWith('image/')) { await sendText(from, 'Solo puedo guardar imágenes o videos MP4 🙏'); return true }
      if (video && (bytes.length > 16 * 1024 * 1024 || !/mp4|3gpp/.test(mime))) { await sendText(from, 'Los videos deben ser MP4 de máximo 16 MB para poder enviarlos por WhatsApp.'); return true }
      const ext = (mime.split('/')[1] ?? 'jpg').split(';')[0].replace('jpeg', 'jpg')
      const path = `biblioteca/${Date.now()}.${ext}`
      const { error: eu } = await sb.storage.from('catalogo').upload(path, bytes, { contentType: mime })
      if (eu) { await sendText(from, `No pude guardar el archivo: ${eu.message}`); return true }
      const url = sb.storage.from('catalogo').getPublicUrl(path).data.publicUrl
      const pie = String(m.caption ?? '').trim()
      const { data: img, error } = await sb.from('bot_imagenes').insert({ descripcion: pie, url, tipo: video ? 'video' : 'image', activo: false }).select('id').single()
      if (error || !img) { await sendText(from, 'No pude guardar el archivo (¿corriste la migración 0046?).'); return true }
      await sb.from('mensajes').update({ contenido: `[El admin envió ${video ? 'un video' : 'una imagen'} (id ${img.id})${pie ? ` con el pie: «${pie}»` : ' sin pie'}. Aún no está guardada: decide qué hacer con lo que diga, o pregúntale qué es y qué quiere hacer]` }).eq('wa_id', msg.id)
      const { data: cfgRows } = await sb.from('config').select('clave,valor')
      await agenteAdmin(sb, Object.fromEntries((cfgRows ?? []).map((r) => [r.clave, r.valor])) as Record<string, string>, from)
    } catch (e) { console.error('mediaAdmin biblioteca', e); await sendText(from, 'No pude procesar el archivo 🙈 ¿lo intentas de nuevo?') }
    return true
  }
  const modo = /^nuevo/i.test(cap[1]) ? 'nuevo' : 'foto'
  const dato = cap[2].trim()
  try {
    const { bytes, mime } = await downloadMedia(m.id)
    const video = mime.startsWith('video/')
    if (!video && !mime.startsWith('image/')) { await sendText(from, 'Solo puedo guardar imágenes o videos MP4 en el catálogo 🙏'); return true }
    if (video && (bytes.length > 16 * 1024 * 1024 || !/mp4|3gpp/.test(mime))) { await sendText(from, 'Los videos deben ser MP4 de máximo 16 MB para poder enviarlos por WhatsApp.'); return true }
    const { data: prods } = await sb.from('productos').select('id,nombre,precio,foto_url,activo')

    let producto: { id: string; nombre: string } | undefined
    let descripcion = ''
    if (modo === 'foto') {
      const q = sinAcento(dato.split(/[,\n]/)[0])
      producto = (prods ?? []).find((p) => sinAcento(p.nombre) === q) ?? (prods ?? []).find((p) => sinAcento(p.nombre).includes(q) || q.includes(sinAcento(p.nombre)))
      if (!producto) { await sendText(from, `No encontré el sabor "${dato}". Sabores: ${(prods ?? []).map((p) => p.nombre).join(', ')}.\nVuelve a enviar el archivo con el pie "foto: <sabor>" o con "nuevo: Nombre, precio, descripción".`); return true }
    } else {
      const partes = dato.split(',').map((x) => x.trim())
      const nombre = partes[0]
      const precio = Number((partes[1] ?? '').replace(/[^\d]/g, ''))
      descripcion = partes.slice(2).join(', ')
      if (!nombre || !precio) { await sendText(from, 'Para crear un sabor necesito el nombre y el precio. Vuelve a enviar el archivo con el pie:\nnuevo: Nombre, precio, descripción\nEj.: nuevo: Maracuyá, 7000, galleta rellena de maracuyá'); return true }
      if ((prods ?? []).some((p) => sinAcento(p.nombre) === sinAcento(nombre))) { await sendText(from, `Ya existe "${nombre}". Para agregarle la foto escribe en el pie: foto: ${nombre}`); return true }
      const { data: nuevo, error } = await sb.from('productos').insert({ nombre, precio, descripcion, detalles: '', activo: false }).select('id,nombre').single()
      if (error || !nuevo) { await sendText(from, `No pude crear el sabor: ${error?.message ?? 'error'}`); return true }
      producto = nuevo
    }

    const ext = (mime.split('/')[1] ?? 'jpg').split(';')[0].replace('jpeg', 'jpg')
    const path = `medios/${producto.id}-${Date.now()}.${ext}`
    const { error: eu } = await sb.storage.from('catalogo').upload(path, bytes, { contentType: mime })
    if (eu) { await sendText(from, `No pude guardar el archivo: ${eu.message}`); return true }
    const url = sb.storage.from('catalogo').getPublicUrl(path).data.publicUrl
    const { data: medios } = await sb.from('producto_medios').select('id,principal,tipo').eq('producto_id', producto.id)
    const hayPrincipal = (medios ?? []).some((x) => x.principal && x.tipo === 'image')
    const principal = !video && !hayPrincipal
    await sb.from('producto_medios').insert({ producto_id: producto.id, url, tipo: video ? 'video' : 'image', principal, orden: (medios ?? []).length })
    if (principal) await sb.from('productos').update({ foto_url: url }).eq('id', producto.id)
    const total = (medios ?? []).length + 1
    await sendText(from, modo === 'nuevo'
      ? `✅ Creé el sabor "${producto.nombre}" (foto principal lista). Queda OCULTO para el bot: complétalo y actívalo en el Catálogo del micrositio (detalles, stock).`
      : `✅ Agregué ${video ? 'el video' : 'la foto'} a ${producto.nombre}${principal ? ' como foto principal' : ''}. Ahora tiene ${total} archivo${total === 1 ? '' : 's'}.${video || !principal ? ' Se envía solo si el cliente pide más.' : ''}`)
  } catch (e) {
    console.error('mediaAdmin', e)
    await sendText(from, 'No pude procesar el archivo 🙈 ¿lo intentas de nuevo?')
  }
  return true
}
