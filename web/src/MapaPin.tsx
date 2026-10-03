import { useEffect, useRef, useState } from 'react'
import { LocateFixed, Search } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Mapa con un pin que se puede arrastrar o colocar tocando el mapa; también busca direcciones (OpenStreetMap).
export default function MapaPin({ lat, lng, onChange, direccion }: { lat: string; lng: string; onChange: (lat: string, lng: string) => void; direccion?: string }) {
  const caja = useRef<HTMLDivElement>(null)
  const mapa = useRef<L.Map | null>(null)
  const pin = useRef<L.Marker | null>(null)
  const [q, setQ] = useState(direccion ?? '')
  const [msg, setMsg] = useState('')
  const cb = useRef(onChange); cb.current = onChange

  useEffect(() => {
    if (!caja.current || mapa.current) return
    const la = Number(lat), ln = Number(lng)
    const hay = !!la && !!ln
    const m = L.map(caja.current).setView(hay ? [la, ln] : [2.5724, -72.6459], hay ? 17 : 13) // San José del Guaviare por defecto
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m)
    const icono = L.divIcon({ className: 'pin-mapa', html: '📍', iconSize: [34, 34], iconAnchor: [17, 32] })
    const poner = (y: number, x: number) => {
      if (pin.current) pin.current.setLatLng([y, x])
      else {
        pin.current = L.marker([y, x], { draggable: true, icon: icono }).addTo(m)
        pin.current.on('dragend', () => { const p = pin.current!.getLatLng(); cb.current(p.lat.toFixed(6), p.lng.toFixed(6)) })
      }
    }
    if (hay) poner(la, ln)
    m.on('click', (e: L.LeafletMouseEvent) => { poner(e.latlng.lat, e.latlng.lng); cb.current(e.latlng.lat.toFixed(6), e.latlng.lng.toFixed(6)) })
    ;(m as unknown as { _poner: typeof poner })._poner = poner
    mapa.current = m
    setTimeout(() => m.invalidateSize(), 250) // el mapa nace dentro de un modal
    return () => { m.remove(); mapa.current = null; pin.current = null }
  }, []) // eslint-disable-line

  const ir = (y: number, x: number, zoom = 17) => {
    const m = mapa.current as (L.Map & { _poner?: (y: number, x: number) => void }) | null
    if (!m) return
    m._poner?.(y, x); m.setView([y, x], zoom); onChange(y.toFixed(6), x.toFixed(6))
  }
  const buscar = async () => {
    if (!q.trim()) return
    setMsg('Buscando…')
    try {
      const r = await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=es&q=${encodeURIComponent(q + ' San José del Guaviare')}`)).json()
      if (!r.length) { setMsg('No encontré esa dirección: toca el mapa para colocar el pin a mano.'); return }
      ir(Number(r[0].lat), Number(r[0].lon)); setMsg('Pin colocado: ajústalo arrastrándolo.')
    } catch { setMsg('No se pudo buscar. Toca el mapa para colocar el pin.') }
  }
  const aqui = () => navigator.geolocation?.getCurrentPosition((p) => { ir(p.coords.latitude, p.coords.longitude); setMsg('Pin en tu ubicación actual.') }, () => setMsg('No se pudo obtener tu ubicación (permite el acceso en el navegador).'))

  return (
    <div>
      <div className="row">
        <input style={{ flex: 1, minWidth: 0 }} aria-label="Buscar dirección o barrio" placeholder="Buscar dirección o barrio" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && buscar()} />
        <button type="button" className="sec" onClick={buscar} aria-label="Buscar dirección" title="Buscar"><Search size={18} aria-hidden /></button>
        <button type="button" className="sec" onClick={aqui} title="Mi ubicación" aria-label="Usar mi ubicación"><LocateFixed size={18} aria-hidden /></button>
      </div>
      <div ref={caja} className="mapa-pin" />
      <p className="muted">{msg || 'Toca el mapa o arrastra el pin hasta la puerta del local.'}{lat && lng ? ` · ${lat}, ${lng}` : ''}</p>
    </div>
  )
}
