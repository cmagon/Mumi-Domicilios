import { useState } from 'react'
import { Cookie, Eye, EyeOff, KeyRound, Loader2, LogIn, Mail, Sparkles } from 'lucide-react'
import { supabase } from '../supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ver, setVer] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [cargando, setCargando] = useState<'entrar' | 'magico' | 'recuperar' | null>(null)

  const correoOk = () => { if (!email.trim()) { setErr('Escribe tu correo primero.'); return false } return true }
  const entrar = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setInfo('')
    if (!correoOk()) return
    if (!password) { setErr('Escribe tu contraseña.'); return }
    setCargando('entrar')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setCargando(null)
    if (error) setErr(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message)
  }
  const magico = async () => {
    setErr(''); setInfo(''); if (!correoOk()) return
    setCargando('magico')
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() })
    setCargando(null)
    if (error) setErr(error.message); else setInfo('Te enviamos un enlace de acceso al correo. Ábrelo desde este dispositivo.')
  }
  const recuperar = async () => {
    setErr(''); setInfo(''); if (!correoOk()) return
    setCargando('recuperar')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim())
    setCargando(null)
    if (error) setErr(error.message); else setInfo('Revisa tu correo para restablecer la contraseña.')
  }

  return (
    <div className="login-fondo">
      <main className="login-main">
        <form className="login-card" onSubmit={entrar} noValidate>
          <div className="login-logo" aria-hidden><Cookie size={34} strokeWidth={1.8} /></div>
          <h1 className="login-titulo">Mumi Delivery</h1>
          <p className="login-sub">Panel de administración</p>

          <label htmlFor="login-correo">Correo</label>
          <div className="campo-ico"><Mail size={18} aria-hidden />
            <input id="login-correo" type="email" inputMode="email" autoComplete="username" autoFocus placeholder="tucorreo@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!err && !email.trim()} /></div>

          <label htmlFor="login-clave">Contraseña</label>
          <div className="campo-ico"><KeyRound size={18} aria-hidden />
            <input id="login-clave" type={ver ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="ojo" aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={ver} onClick={() => setVer(!ver)}>{ver ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>

          <div role="alert" aria-live="assertive">{err && <p className="login-err">{err}</p>}</div>
          <div role="status" aria-live="polite">{info && <p className="login-ok">{info}</p>}</div>

          <button type="submit" className="login-entrar" disabled={cargando !== null}>
            {cargando === 'entrar' ? <Loader2 size={18} className="girar" aria-hidden /> : <LogIn size={18} aria-hidden />} Entrar
          </button>
          <button type="button" className="sec login-magico" onClick={magico} disabled={cargando !== null}>
            {cargando === 'magico' ? <Loader2 size={18} className="girar" aria-hidden /> : <Sparkles size={18} aria-hidden />} Entrar con enlace al correo
          </button>
          <button type="button" className="login-olvide" onClick={recuperar} disabled={cargando !== null}>Olvidé mi contraseña</button>
        </form>
        <p className="login-pie">Acceso solo para el equipo de Mumi</p>
      </main>
    </div>
  )
}
