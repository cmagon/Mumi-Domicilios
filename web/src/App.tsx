import { useEffect, useState } from 'react'
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
import Avisos from './pages/Avisos'
import Chats from './pages/Chats'
import AlertaIA from './AlertaIA'
import { ToastProvider } from './ui'

const IDLE_MS = 12 * 60 * 60 * 1000 // cierre de sesión tras 12h de inactividad

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [esAdmin, setEsAdmin] = useState<boolean | null>(null)
  const { cfg } = useConfig()
  const loc = useLocation()
  const [noLeidos, setNoLeidos] = useState(0)

  // Avisos del bot (pagos, atención humana, cosas que no pudo resolver): contador en vivo + notificación del navegador
  useEffect(() => {
    if (!esAdmin) return
    const contar = () => supabase.from('notificaciones').select('id', { count: 'exact', head: true }).eq('leida', false).then(({ count }) => setNoLeidos(count ?? 0))
    contar()
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
    const ch = supabase.channel('avisos-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificaciones' }, (p) => {
        contar()
        if ('Notification' in window && Notification.permission === 'granted') new Notification(String(p.new.titulo), { body: String(p.new.detalle ?? '') })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notificaciones' }, () => contar())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [esAdmin])

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

  const tabs: [string, string][] = [['/', 'Producción'], ['/avisos', noLeidos ? `Avisos 🔴${noLeidos}` : 'Avisos'], ['/pedidos', 'Pedidos'], ['/manual', 'Pedido manual'],
    ['/chats', 'Chats'], ['/clientes', 'Clientes'], ['/catalogo', 'Catálogo'], ['/tarifas', 'Tarifas'], ['/config', 'Configuración'], ['/kpis', 'KPIs']]
  return (
    <ToastProvider>
      <header className="top">
        {cfg.logo_url && <img src={cfg.logo_url} alt="Mumi" />}
        <h1>Mumi Delivery</h1>
        <button className="sec sm" onClick={() => supabase.auth.signOut()}>Salir</button>
      </header>
      <AlertaIA />
      <nav className="tabs">
        {tabs.map(([to, l]) => <NavLink key={to} to={to} end={to === '/'}>{l}</NavLink>)}
      </nav>
      <main key={loc.pathname}>
        <Routes>
          <Route path="/" element={<Produccion />} />
          <Route path="/avisos" element={<Avisos />} />
          <Route path="/chats" element={<Chats />} />
          <Route path="/pedidos" element={<Pedidos />} />
          <Route path="/manual" element={<PedidoManual />} />
          <Route path="/catalogo" element={<Catalogo />} />
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
