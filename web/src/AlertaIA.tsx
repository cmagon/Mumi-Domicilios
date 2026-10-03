import { avisoLocal } from './notificaciones'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

type A = { id: string; tipo: string; detalle: string; creado_en: string }
const TITULO: Record<string, string> = {
  cuota: 'Se acabó el saldo o el límite del proveedor de IA',
  clave: 'La API key de IA es inválida o falta',
  audio: 'Falló la lectura de una nota de voz',
  error: 'Error del proveedor de IA',
}

// Banner rojo mientras haya errores de IA sin resolver en las últimas 24 h (revisa cada 30 s)
export default function AlertaIA() {
  const [alertas, setAlertas] = useState<A[]>([])
  const [ver, setVer] = useState(false)
  const cargar = useCallback(async () => {
    const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { data } = await supabase.from('alertas_ia').select('id,tipo,detalle,creado_en').eq('resuelta', false)
      .gte('creado_en', desde).order('creado_en', { ascending: false }).limit(50)
    setAlertas((prev) => {
      if ((data?.length ?? 0) > prev.length && data?.[0]) void avisoLocal('Bot Mumi: error de IA', TITULO[data[0].tipo] ?? data[0].detalle)
      return data ?? []
    })
  }, [])
  useEffect(() => { cargar(); const t = setInterval(cargar, 30000); return () => clearInterval(t) }, [cargar])
  if (!alertas.length) return null
  const resolver = async () => { await supabase.from('alertas_ia').update({ resuelta: true }).in('id', alertas.map((a) => a.id)); cargar() }
  const ultima = alertas[0]
  return (
    <div style={{ background: '#b00020', color: '#fff', padding: '10px 16px' }}>
      <b>⚠️ El bot tuvo {alertas.length} error{alertas.length === 1 ? '' : 'es'} de IA.</b> {TITULO[ultima.tipo] ?? ultima.detalle}
      <div style={{ marginTop: 6 }}>
        <button className="sm" style={{ background: '#fff', color: '#b00020' }} onClick={() => setVer(!ver)}>{ver ? 'Ocultar' : 'Ver detalle'}</button>{' '}
        <button className="sm" style={{ background: '#fff', color: '#b00020' }} onClick={resolver}>Marcar como resuelto</button>
      </div>
      {ver && alertas.slice(0, 5).map((a) => (
        <p key={a.id} style={{ fontSize: 12, margin: '6px 0 0' }}>{new Date(a.creado_en).toLocaleString()} · {a.tipo}: {a.detalle}</p>))}
    </div>
  )
}
