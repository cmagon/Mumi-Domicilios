import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { useToast, Info } from './ui'

type Medio = { id: string; url: string; tipo: 'image' | 'video'; principal: boolean; orden: number }

// Fotos y videos de un producto. La principal es la única que el bot envía al ofrecer fotos; las demás solo si el cliente pide más.
export default function GaleriaMedios({ productoId, onPrincipal }: { productoId: string; onPrincipal?: (url: string) => void }) {
  const toast = useToast()
  const [medios, setMedios] = useState<Medio[]>([])
  const [subiendo, setSubiendo] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('producto_medios').select('*').eq('producto_id', productoId).order('orden')
    setMedios((data ?? []) as Medio[])
  }, [productoId])
  useEffect(() => { cargar() }, [cargar])

  const subir = async (files: FileList | null) => {
    if (!files?.length) return
    setSubiendo(true)
    let orden = medios.length, hayPrincipal = medios.some((m) => m.principal && m.tipo === 'image')
    for (const f of Array.from(files)) {
      const video = f.type.startsWith('video/')
      if (video && (f.size > 16 * 1024 * 1024 || !/mp4|3gpp/.test(f.type))) { toast(`${f.name}: WhatsApp solo acepta videos MP4 de hasta 16 MB`, 'err'); continue }
      const path = `medios/${productoId}-${Date.now()}-${orden}.${f.name.split('.').pop()}`
      const { error } = await supabase.storage.from('catalogo').upload(path, f, { contentType: f.type })
      if (error) { toast(error.message, 'err'); continue }
      const url = supabase.storage.from('catalogo').getPublicUrl(path).data.publicUrl
      const principal = !video && !hayPrincipal
      const { error: e2 } = await supabase.from('producto_medios').insert({ producto_id: productoId, url, tipo: video ? 'video' : 'image', principal, orden: orden++ })
      if (e2) { toast(e2.message, 'err'); continue }
      if (principal) { hayPrincipal = true; await supabase.from('productos').update({ foto_url: url }).eq('id', productoId); onPrincipal?.(url) }
    }
    setSubiendo(false); if (input.current) input.current.value = ''; cargar()
  }
  const hacerPrincipal = async (m: Medio) => {
    await supabase.from('producto_medios').update({ principal: false }).eq('producto_id', productoId)
    await supabase.from('producto_medios').update({ principal: true }).eq('id', m.id)
    await supabase.from('productos').update({ foto_url: m.url }).eq('id', productoId)
    onPrincipal?.(m.url); toast('Foto principal actualizada'); cargar()
  }
  const quitar = async (m: Medio) => {
    const { error } = await supabase.from('producto_medios').delete().eq('id', m.id)
    if (error) { toast(error.message, 'err'); return }
    const ruta = m.url.split('/catalogo/')[1]; if (ruta) supabase.storage.from('catalogo').remove([ruta])
    if (m.principal) { const sig = medios.find((x) => x.id !== m.id && x.tipo === 'image'); if (sig) await hacerPrincipal(sig) }
    cargar()
  }

  return (
    <div>
      <div className="galeria">
        {medios.map((m) => (
          <div className={`medio ${m.principal ? 'principal' : ''}`} key={m.id}>
            {m.tipo === 'video' ? <video src={m.url} muted playsInline preload="metadata" /> : <img src={m.url} alt="" />}
            {m.tipo === 'video' && <span className="medio-tipo">🎬</span>}
            <div className="medio-acc">
              {m.tipo === 'image' && !m.principal && <button className="sec sm" onClick={() => hacerPrincipal(m)} title="Hacer principal">⭐</button>}
              {m.principal && <span className="badge ok">Principal</span>}
              <button className="sec sm" onClick={() => quitar(m)} aria-label="Quitar">🗑</button>
            </div>
          </div>))}
        <button type="button" className="medio nuevo" disabled={subiendo} onClick={() => input.current?.click()}>{subiendo ? 'Subiendo…' : '＋ Agregar'}</button>
      </div>
      <input ref={input} type="file" accept="image/*,video/mp4" multiple hidden onChange={(e) => subir(e.target.files)} />
      <Info bloque>⭐ La foto <b>principal</b> es la que se envía al ofrecer fotos. Las demás fotos y los videos (MP4, máx. 16 MB) se envían solo si el cliente pide más.</Info>
    </div>
  )
}
