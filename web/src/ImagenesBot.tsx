import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { AsyncButton, Confirmar, useToast, type Confirmacion } from './ui'

type Img = { id: string; descripcion: string; url: string; tipo: 'image' | 'video'; activo: boolean; creado_en: string }

// Biblioteca de imágenes y videos con contexto que el bot puede enviar en las conversaciones (también se llena por WhatsApp desde el número del admin)
export default function ImagenesBot() {
  const toast = useToast()
  const [lista, setLista] = useState<Img[]>([])
  const [archivo, setArchivo] = useState<File | null>(null)
  const [desc, setDesc] = useState('')
  const [conf, setConf] = useState<Confirmacion | null>(null)
  const cargar = async () => { const { data } = await supabase.from('bot_imagenes').select('*').order('creado_en', { ascending: false }); setLista((data ?? []) as Img[]) }
  useEffect(() => { cargar() }, [])

  const subir = async () => {
    if (!archivo || !desc.trim()) { toast('Elige un archivo y escribe su contexto', 'err'); return false }
    const ruta = `biblioteca/${Date.now()}.${archivo.name.split('.').pop()}`
    const { error } = await supabase.storage.from('catalogo').upload(ruta, archivo, { contentType: archivo.type })
    if (error) { toast(error.message, 'err'); return false }
    const url = supabase.storage.from('catalogo').getPublicUrl(ruta).data.publicUrl
    const { error: e2 } = await supabase.from('bot_imagenes').insert({ descripcion: desc.trim().slice(0, 300), url, tipo: archivo.type.startsWith('video/') ? 'video' : 'image', activo: true })
    if (e2) { toast(e2.code === '42P01' ? 'Falta correr la migración 0046 en Supabase' : e2.message, 'err'); return false }
    setArchivo(null); setDesc(''); toast('Guardada: el bot ya puede usarla'); cargar()
  }
  const guardarDesc = async (i: Img, d: string) => { if (d.trim() === i.descripcion) return; await supabase.from('bot_imagenes').update({ descripcion: d.trim().slice(0, 300), activo: !!d.trim() }).eq('id', i.id); toast('Contexto actualizado'); cargar() }
  const quitar = (i: Img) => setConf({ titulo: 'Quitar del bot', peligro: true, okText: 'Eliminar', texto: <>El bot dejará de usar este archivo.</>,
    onOk: async () => { const { error } = await supabase.from('bot_imagenes').delete().eq('id', i.id); if (error) { toast(error.message, 'err'); return false } toast('Eliminada'); cargar() } })

  const pendientes = lista.filter((i) => !i.activo)
  return (
    <>
      <p className="muted">Material con contexto para que el bot lo use en las conversaciones (por ejemplo "así se ven las galletas en una caja"). También puedes enviárselo por WhatsApp desde el número del admin con una imagen y decirle qué es.</p>
      <div className="card" style={{ marginBottom: 12 }}>
        <label>Subir imagen o video</label>
        <input type="file" accept="image/*,video/mp4" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
        <label>Contexto (qué es y cuándo usarla)</label>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ej. Así se ven las galletas en la caja de 6" />
        <div className="row"><AsyncButton okText="Guardada" onClick={subir} disabled={!archivo || !desc.trim()}>Guardar para el bot</AsyncButton></div>
      </div>
      <div className="tarjetas">
        {lista.filter((i) => i.activo).map((i) => (
          <div className="tarjeta" key={i.id}>
            {i.tipo === 'video' ? <video className="foto" src={i.url} controls /> : <img className="foto" src={i.url} alt={i.descripcion} />}
            <div className="info">
              <textarea style={{ minHeight: 56 }} defaultValue={i.descripcion} onBlur={(e) => guardarDesc(i, e.target.value)} />
              <div className="pie"><span className="muted" style={{ fontSize: 12 }}>{i.tipo === 'video' ? '🎬 Video' : '🖼 Imagen'}</span><button className="sec sm" onClick={() => quitar(i)} aria-label="Eliminar">🗑</button></div>
            </div>
          </div>))}
      </div>
      {!lista.some((i) => i.activo) && <p className="muted">Aún no hay material guardado.</p>}
      {pendientes.length > 0 && <p className="muted">Hay {pendientes.length} archivo{pendientes.length === 1 ? '' : 's'} recibido{pendientes.length === 1 ? '' : 's'} por WhatsApp sin contexto todavía (el asistente te preguntará qué son).</p>}
      <Confirmar c={conf} onClose={() => setConf(null)} />
    </>
  )
}
