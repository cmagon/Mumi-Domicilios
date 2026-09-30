// Geocodificación inversa (OpenStreetMap / Nominatim, gratuita): convierte coordenadas en una dirección aproximada.
export async function direccionAprox(lat: number, lng: number): Promise<string | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=es&lat=${lat}&lon=${lng}`,
      { headers: { 'User-Agent': 'MumiDomicilios/1.0 (bot de pedidos)' }, signal: AbortSignal.timeout(5000) })
    if (!r.ok) return null
    const a = (await r.json())?.address ?? {}
    const via = [a.road, a.house_number].filter(Boolean).join(' ')
    const barrio = a.neighbourhood || a.suburb || a.quarter || a.city_district
    const ciudad = a.city || a.town || a.village || a.municipality
    const txt = [via, barrio, ciudad].filter(Boolean).join(', ')
    return txt || null
  } catch { return null }
}
