import { useState } from 'react'
import { apiFetch } from '../api.js'

export default function AuthPage({ onLogin }) {
  const [tab, setTab] = useState('login')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [registerForm, setRegisterForm] = useState({ username: '', email: '', password: '' })

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(loginForm),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) return setError(data.error)
    onLogin(data)
  }

  async function handleRegister(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(registerForm),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) return setError(data.error)
    onLogin(data)
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="board-icon" style={{ width: 44, height: 44, fontSize: 20, borderRadius: 12 }}>S</div>
          <span className="auth-brand">Scuffed Trello</span>
        </div>

        <div className="auth-tabs">
          <button
            className={`auth-tab${tab === 'login' ? ' active' : ''}`}
            onClick={() => { setTab('login'); setError('') }}
          >
            Log in
          </button>
          <button
            className={`auth-tab${tab === 'register' ? ' active' : ''}`}
            onClick={() => { setTab('register'); setError('') }}
          >
            Register
          </button>
        </div>

        {tab === 'login' ? (
          <form className="auth-form" onSubmit={handleLogin}>
            <label className="auth-label">Username or email</label>
            <input
              className="card-input"
              placeholder="username or email"
              value={loginForm.username}
              onChange={e => setLoginForm(f => ({ ...f, username: e.target.value }))}
              autoFocus
              required
            />
            <label className="auth-label">Password</label>
            <input
              className="card-input"
              type="password"
              placeholder="password"
              value={loginForm.password}
              onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
              required
            />
            {error && <p className="auth-error">{error}</p>}
            <button className="btn-primary auth-submit" type="submit" disabled={loading}>
              {loading ? 'Logging in…' : 'Log in'}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={handleRegister}>
            <label className="auth-label">Username</label>
            <input
              className="card-input"
              placeholder="username"
              value={registerForm.username}
              onChange={e => setRegisterForm(f => ({ ...f, username: e.target.value }))}
              autoFocus
              required
            />
            <label className="auth-label">Email</label>
            <input
              className="card-input"
              type="email"
              placeholder="you@example.com"
              value={registerForm.email}
              onChange={e => setRegisterForm(f => ({ ...f, email: e.target.value }))}
              required
            />
            <label className="auth-label">Password</label>
            <input
              className="card-input"
              type="password"
              placeholder="password"
              value={registerForm.password}
              onChange={e => setRegisterForm(f => ({ ...f, password: e.target.value }))}
              required
            />
            {error && <p className="auth-error">{error}</p>}
            <button className="btn-primary auth-submit" type="submit" disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
