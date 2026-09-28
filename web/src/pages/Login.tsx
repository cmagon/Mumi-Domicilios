import { useState } from 'react'
import { supabase } from '../supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const entrar = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setErr(error.message)
  }
  const magico = async () => {
    setErr(''); setInfo('')
    const { error } = await supabase.auth.signInWithOtp({ email })
    if (error) setErr(error.message); else setInfo('Te enviamos un enlace al correo.')
  }
  const recuperar = async () => {
    setErr(''); setInfo('')
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    if (error) setErr(error.message); else setInfo('Revisa tu correo para restablecer la contraseña.')
  }
  return (
    <main style={{ maxWidth: 380 }}>
      <form className="card" onSubmit={entrar}>
        <h2>Mumi Delivery — Administración</h2>
        <label>Correo</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Contraseña</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="err">{err}</p><p className="muted">{info}</p>
        <div className="row"><button type="submit">Entrar</button>
          <button type="button" className="sec" onClick={magico}>Link mágico</button></div>
        <p><a href="#" onClick={(e) => { e.preventDefault(); recuperar() }}>Olvidé mi contraseña</a></p>
      </form>
    </main>
  )
}
