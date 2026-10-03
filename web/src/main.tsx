import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { configOk } from './supabase'
import { registerSW } from 'virtual:pwa-register'
import { activarActualizacionAutomatica, limpiarYRecargar } from './actualizar'

activarActualizacionAutomatica(registerSW as never)

function Aviso({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <main style={{ maxWidth: 520 }}>
      <div className="card">
        <h2>{titulo}</h2>
        <p style={{ whiteSpace: 'pre-wrap' }}>{detalle}</p>
        <button onClick={limpiarYRecargar}>Limpiar caché y recargar</button>
      </div>
    </main>
  )
}

class Limite extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    return this.state.error
      ? <Aviso titulo="Algo falló al cargar el micrositio" detalle={`${this.state.error.message}\n\nSi el problema continúa, envía este mensaje.`} />
      : this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {configOk
      ? <Limite><BrowserRouter><App /></BrowserRouter></Limite>
      : <Aviso titulo="Falta la configuración de conexión"
          detalle={'No están definidas las variables VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.\nEn Cloudflare: proyecto → Settings → Build → Variables and secrets. Luego vuelve a desplegar (Retry deployment).'} />}
  </StrictMode>,
)
