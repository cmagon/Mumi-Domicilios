import { useEffect, useRef, useState } from 'react'
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { useConfig } from './hooks'
import Login from './pages/Login'
import Produccion from './pages/Produccion'
import Pedidos from './pages/Pedidos'
import Catalogo from './pages/Catalogo'
import Tarifas from './pages/Tarifas'
import Configuracion from './pages/Configuracion'
import PedidoManual from './pages/PedidoManual'
import Kpis from './pages/Kpis'
import Clientes from './pages/Clientes'
import Chats from './pages/Chats'
import Campanas from './pages/Campanas'
import AlertaIA from './AlertaIA'
import { ToastProvider } from './ui'
import { tono, desbloquearAudio } from './sonido'
import { avisoLocal, suscripcionActual } from './notificaciones'
import { numerosEquipo } from './equipo'

const IDLE_MS = 12 * 60 * 60 * 1000 // cierre de sesión tras 12h de inactividad

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [esAdmin, setEsAdmin] = useState<boolean | null>(null)
  const { cfg } = useConfig()
  const equipoRef = useRef<string[]>([])
  equipoRef.current = numerosEquipo(cfg)
  const loc = useLocation()
  const [noLeidos, setNoLeidos] = useState(0)
  const [menu, setMenu] = useState(false)
  useEffect(() => setMenu(false), [loc.pathname])

  // Avisos del bot (pagos, atención humana, cosas que no pudo resolver): contador en vivo + notificación del navegador
  useEffect(() => {
    if (!esAdmin) return
    let conPush = false // si el dispositivo tiene push, el service worker muestra la notificación del sistema
    suscripcionActual().then((s) => { conPush = !!s }).catch(() => {})
    desbloquearAudio()
    const contar = () => {
      // Los chats del equipo (admin, socios, domiciliario) no cuentan como clientes por revisar
      const eq = equipoRef.current
      let q = supabase.from('chats_bandeja').select('telefono', { count: 'exact', head: true }).or('avisos.gt.0,no_leidos.gt.0')
      if (eq.length) q = q.not('telefono', 'in', `(${eq.join(',')})`)
      return q.then(({ count }) => setNoLeidos(count ?? 0))
    }
    contar()
    const onSw = (e: MessageEvent) => { if (e.data?.tipo === 'push') { contar(); tono(false) } else if (e.data?.tipo === 'abrir') window.location.assign(e.data.url || '/chats') }
    navigator.serviceWorker?.addEventListener('message', onSw)
    const alVolver = () => { if (!document.hidden) contar() } // al volver a la app, el número del ícono se actualiza
    document.addEventListener('visibilitychange', alVolver)
    const sondeo = window.setInterval(() => { if (!document.hidden) contar() }, 15000) // respaldo si el tiempo real se cae
    const ch = supabase.channel('avisos-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificaciones' }, (p) => {
        contar(); tono(false)
        if (!conPush) void avisoLocal(String(p.new.titulo), String(p.new.detalle ?? ''))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notificaciones' }, () => contar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversaciones' }, () => contar())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes' }, (p) => {
        contar(); if (p.new.rol === 'user' && p.new.contenido !== '…') tono(false)
        if (!conPush && p.new.rol === 'user' && document.hidden) void avisoLocal('Mensaje de cliente', String(p.new.contenido ?? '').slice(0, 120))
      })
      .subscribe()
    return () => { window.clearInterval(sondeo); navigator.serviceWorker?.removeEventListener('message', onSw); document.removeEventListener('visibilitychange', alVolver); supabase.removeChannel(ch) }
  }, [esAdmin])

  // Indicador de chats por revisar: número en el título de la pestaña y en el ícono de la app instalada (barra de tareas / pantalla de inicio)
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, '')
    document.title = noLeidos > 0 ? `(${noLeidos}) ${base}` : base
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    try { if (noLeidos > 0) void nav.setAppBadge?.(noLeidos); else void nav.clearAppBadge?.() } catch { /* no soportado */ }
  }, [noLeidos])

  // El logo definido por el admin es también el favicon y el ícono de la app instalada
  useEffect(() => {
    const icono = cfg.favicon_url || cfg.logo_url
    if (!icono) return
    const set = (rel: string, href: string, extra: Record<string, string> = {}) => {
      let l = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
      if (!l) { l = document.createElement('link'); l.rel = rel; document.head.appendChild(l) }
      l.href = href; Object.entries(extra).forEach(([k, v]) => l!.setAttribute(k, v))
    }
    set('icon', icono); document.querySelector('link[rel="icon"]')?.removeAttribute('type'); set('apple-touch-icon', icono)
    const mime = /\.png/i.test(icono) ? 'image/png' : /\.svg/i.test(icono) ? 'image/svg+xml' : /\.webp/i.test(icono) ? 'image/webp' : 'image/jpeg'
    const man = { name: 'Mumi Delivery', short_name: 'Mumi', start_url: location.origin + '/', scope: location.origin + '/', display: 'standalone', background_color: '#ffffff', theme_color: '#6e140d',
      icons: [{ src: icono, sizes: '192x192', type: mime, purpose: 'any' }, { src: icono, sizes: '512x512', type: mime, purpose: 'any' }] }
    const url = URL.createObjectURL(new Blob([JSON.stringify(man)], { type: 'application/manifest+json' }))
    set('manifest', url)
    return () => URL.revokeObjectURL(url)
  }, [cfg.logo_url, cfg.favicon_url])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setEsAdmin(null); return }
    supabase.from('perfiles').select('rol').eq('user_id', session.user.id).maybeSingle()
      .then(({ data }) => setEsAdmin(data?.rol === 'admin'))
  }, [session])

  useEffect(() => {
    if (!session) return
    let t: number
    const reset = () => { clearTimeout(t); t = window.setTimeout(() => supabase.auth.signOut(), IDLE_MS) }
    const ev = ['click', 'keydown', 'touchstart']
    ev.forEach((e) => window.addEventListener(e, reset)); reset()
    return () => { clearTimeout(t); ev.forEach((e) => window.removeEventListener(e, reset)) }
  }, [session])

  if (session === undefined) return <main>Cargando…</main>
  if (!session) return <Login />
  if (esAdmin === false) return (
    <main><div className="card"><h2>Sin acceso</h2>
      <p>Tu usuario no tiene rol admin. Pide que lo agreguen a la tabla <code>perfiles</code>.</p>
      <button onClick={() => supabase.auth.signOut()}>Salir</button></div></main>
  )

  const tabs: [string, string, string][] = [['/chats', '💬', 'Chats'], ['/pedidos', '📋', 'Pedidos'], ['/', '🔥', 'Producción'], ['/manual', '➕', 'Pedido manual'],
    ['/clientes', '👥', 'Clientes'], ['/catalogo', '🧁', 'Catálogo'], ['/campanas', '📣', 'Campañas'], ['/tarifas', '🛵', 'Tarifas'], ['/kpis', '📈', 'KPIs'], ['/config', '⚙️', 'Configuración']]
  const enChats = loc.pathname === '/chats'
  return (
    <ToastProvider>
      <header className="top">
        <button className="burger" aria-label="Menú" onClick={() => setMenu(true)}>☰{noLeidos > 0 && <span className="punto">{noLeidos}</span>}</button>
        {cfg.logo_url ? <img className="logo-cab" src={cfg.logo_url} alt="Mumi" /> : <span className="logo-cab-vacio">🍪</span>}
        <span style={{ flex: 1 }} />
        <button className="salir" onClick={() => supabase.auth.signOut()}>⏻ Cerrar sesión</button>
      </header>
      <AlertaIA />
      <nav className="tabs">
        {tabs.map(([to, , l]) => <NavLink key={to} to={to} end={to === '/'}>{l}{to === '/chats' && noLeidos > 0 ? ` 🔴${noLeidos}` : ''}</NavLink>)}
      </nav>
      {menu && <>
        <div className="drawer-fondo" onClick={() => setMenu(false)} />
        <aside className="drawer">
          <div className="drawer-cab">{cfg.logo_url && <img src={cfg.logo_url} alt="" />}<b>Mumi Delivery</b><button className="ghost" style={{ color: '#fff' }} onClick={() => setMenu(false)}>✕</button></div>
          {tabs.map(([to, ico, l]) => <NavLink key={to} to={to} end={to === '/'}><span className="ico">{ico}</span>{l}{to === '/chats' && noLeidos > 0 && <span className="cuenta">{noLeidos}</span>}</NavLink>)}
          <div className="drawer-pie"><button className="sec" style={{ width: '100%' }} onClick={() => supabase.auth.signOut()}>⏻ Cerrar sesión</button></div>
        </aside></>}
      <main key={loc.pathname} className={enChats ? 'ancho' : ''}>
        <Routes>
          <Route path="/" element={<Produccion />} />
          <Route path="/avisos" element={<Navigate to="/chats" />} />
          <Route path="/chats" element={<Chats />} />
          <Route path="/pedidos" element={<Pedidos />} />
          <Route path="/manual" element={<PedidoManual />} />
          <Route path="/catalogo" element={<Catalogo />} />
          <Route path="/campanas" element={<Campanas />} />
          <Route path="/tarifas" element={<Tarifas />} />
          <Route path="/config" element={<Configuracion />} />
          <Route path="/kpis" element={<Kpis />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </ToastProvider>
  )
}
