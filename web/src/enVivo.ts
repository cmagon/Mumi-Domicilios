import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

type Cambio = { tabla: string; evento?: '*' | 'INSERT' | 'UPDATE' | 'DELETE'; filtro?: string }

// Mantiene una vista al día sin recargar: suscripción en tiempo real + reconexión automática + refresco al volver a la pestaña,
// al recuperar internet y un sondeo de respaldo cada `cadaSeg` s (por si el tiempo real se cae en silencio).
export function useEnVivo(nombre: string, cambios: Cambio[], recargar: () => void, cadaSeg = 12) {
  const rec = useRef(recargar); rec.current = recargar
  const clave = JSON.stringify(cambios)
  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | null = null
    let cerrado = false, reintento: number | undefined
    const conectar = () => {
      if (cerrado) return
      let c = supabase.channel(`${nombre}-${Math.random().toString(36).slice(2, 7)}`)
      for (const x of cambios) c = c.on('postgres_changes' as never, { event: x.evento ?? '*', schema: 'public', table: x.tabla, ...(x.filtro ? { filter: x.filtro } : {}) } as never, () => rec.current())
      c.subscribe((estado: string) => {
        if (cerrado) return
        if (estado === 'SUBSCRIBED') rec.current() // al (re)conectar, ponerse al día
        if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(estado)) {
          window.clearTimeout(reintento)
          reintento = window.setTimeout(() => { if (ch) supabase.removeChannel(ch); ch = null; conectar() }, 3000)
        }
      })
      ch = c
    }
    conectar()
    const refrescar = () => { if (!document.hidden) rec.current() }
    const t = window.setInterval(refrescar, cadaSeg * 1000)
    document.addEventListener('visibilitychange', refrescar); window.addEventListener('focus', refrescar); window.addEventListener('online', refrescar)
    return () => {
      cerrado = true; window.clearTimeout(reintento); window.clearInterval(t)
      document.removeEventListener('visibilitychange', refrescar); window.removeEventListener('focus', refrescar); window.removeEventListener('online', refrescar)
      if (ch) supabase.removeChannel(ch)
    }
  }, [nombre, clave]) // eslint-disable-line
}
