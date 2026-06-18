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
      <div className="auth-visual">
        <div className="auth-visual-brand">
          <div className="board-icon board-icon--brand" style={{ width: 36, height: 36, borderRadius: 10 }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
              <rect x="3" y="4" width="5" height="16" rx="1.6" fill="currentColor" />
              <rect x="9.5" y="4" width="5" height="10" rx="1.6" fill="currentColor" opacity="0.85" />
              <rect x="16" y="4" width="5" height="13" rx="1.6" fill="currentColor" opacity="0.65" />
            </svg>
          </div>
          <span className="auth-brand">Scuffed Trello</span>
        </div>

        <h1 className="auth-visual-heading">Organize anything, together.</h1>
        <p className="auth-visual-sub">Boards, columns, and cards that keep your whole team in sync — from sprint planning to weekend chores.</p>

        <div className="auth-mock-board" aria-hidden="true">
          <div className="auth-mock-col">
            <div className="auth-mock-col-title">To do</div>
            <div className="auth-mock-card">
              <span className="auth-mock-tag" />
              <span className="auth-mock-line" style={{ width: '80%' }} />
              <span className="auth-mock-line" style={{ width: '55%' }} />
            </div>
            <div className="auth-mock-card">
              <span className="auth-mock-tag auth-mock-tag--alt" />
              <span className="auth-mock-line" style={{ width: '65%' }} />
            </div>
          </div>
          <div className="auth-mock-col">
            <div className="auth-mock-col-title">In progress</div>
            <div className="auth-mock-card auth-mock-card--active">
              <span className="auth-mock-tag" />
              <span className="auth-mock-line" style={{ width: '70%' }} />
              <span className="auth-mock-line" style={{ width: '40%' }} />
            </div>
          </div>
          <div className="auth-mock-col">
            <div className="auth-mock-col-title">Done</div>
            <div className="auth-mock-card auth-mock-card--done">
              <span className="auth-mock-tag auth-mock-tag--alt" />
              <span className="auth-mock-line" style={{ width: '60%' }} />
            </div>
            <div className="auth-mock-card auth-mock-card--done">
              <span className="auth-mock-tag" />
              <span className="auth-mock-line" style={{ width: '75%' }} />
            </div>
          </div>
        </div>
      </div>

      <div className="auth-form-panel">
      <div className="auth-card">
        <div className="auth-mobile-brand">
          <div className="board-icon board-icon--brand" style={{ width: 36, height: 36, borderRadius: 10 }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
              <rect x="3" y="4" width="5" height="16" rx="1.6" fill="currentColor" />
              <rect x="9.5" y="4" width="5" height="10" rx="1.6" fill="currentColor" opacity="0.85" />
              <rect x="16" y="4" width="5" height="13" rx="1.6" fill="currentColor" opacity="0.65" />
            </svg>
          </div>
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
            <label className="auth-label">Username / Email</label>
            <input
              className="card-input"
              placeholder="Enter username or email"
              value={loginForm.username}
              onChange={e => setLoginForm(f => ({ ...f, username: e.target.value }))}
              autoFocus
              required
            />
            <label className="auth-label">Password</label>
            <input
              className="card-input"
              type="password"
              placeholder="Enter password"
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
    </div>
  )
}
