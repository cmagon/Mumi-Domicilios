import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export function useConfig() {
  const [cfg, setCfg] = useState<Record<string, string>>({})
  const [ids, setIds] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    const { data } = await supabase.from('config').select('id,clave,valor')
    setCfg(Object.fromEntries((data ?? []).map((r) => [r.clave, r.valor])))
    setIds(Object.fromEntries((data ?? []).map((r) => [r.clave, r.id])))
  }, [])
  useEffect(() => { load() }, [load])
  const save = async (clave: string, valor: string) => {
    if (ids[clave]) await supabase.from('config').update({ valor }).eq('id', ids[clave])
    else await supabase.from('config').insert({ clave, valor })
    await load()
  }
  return { cfg, save, reload: load }
}

export const hoy = () => new Date().toLocaleDateString('en-CA')
export const cop = (n: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)
