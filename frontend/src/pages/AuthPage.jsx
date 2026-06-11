import { useState } from 'react'
import { apiFetch } from '../api.js'

export default function AuthPage({ onLogin }) {
  const [tab, setTab] = useState('login')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [forgotPw, setForgotPw] = useState(false)
  const [resetForm, setResetForm] = useState({ username: '', newPassword: '', confirmPassword: '' })
  const [resetSuccess, setResetSuccess] = useState(false)

  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [registerForm, setRegisterForm] = useState({ username: '', email: '', password: '' })

  async function handleResetPassword(e) {
    e.preventDefault()
    setError('')
    if (resetForm.newPassword !== resetForm.confirmPassword) return setError('Passwords do not match')
    if (resetForm.newPassword.length < 6) return setError('Password must be at least 6 characters')
    setLoading(true)
    const res = await apiFetch('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ username: resetForm.username, newPassword: resetForm.newPassword }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) return setError(data.error)
    setResetSuccess(true)
  }

  function backToLogin() {
    setForgotPw(false)
    setResetSuccess(false)
    setResetForm({ username: '', newPassword: '', confirmPassword: '' })
    setError('')
  }

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
          forgotPw ? (
            resetSuccess ? (
              <div className="auth-form">
                <p className="auth-reset-success">Password reset! You can now log in with your new password.</p>
                <button className="btn-primary auth-submit" onClick={backToLogin}>Back to login</button>
              </div>
            ) : (
              <form className="auth-form" onSubmit={handleResetPassword}>
                <label className="auth-label">Username or email</label>
                <input
                  className="card-input"
                  placeholder="username or email"
                  value={resetForm.username}
                  onChange={e => setResetForm(f => ({ ...f, username: e.target.value }))}
                  maxLength={255}
                  autoFocus
                  required
                />
                <label className="auth-label">New password</label>
                <input
                  className="card-input"
                  type="password"
                  placeholder="new password"
                  value={resetForm.newPassword}
                  onChange={e => setResetForm(f => ({ ...f, newPassword: e.target.value }))}
                  maxLength={255}
                  required
                />
                <label className="auth-label">Confirm new password</label>
                <input
                  className="card-input"
                  type="password"
                  placeholder="confirm new password"
                  value={resetForm.confirmPassword}
                  onChange={e => setResetForm(f => ({ ...f, confirmPassword: e.target.value }))}
                  maxLength={255}
                  required
                />
                {error && <p className="auth-error">{error}</p>}
                <button className="btn-primary auth-submit" type="submit" disabled={loading}>
                  {loading ? 'Resetting…' : 'Reset password'}
                </button>
                <button className="auth-forgot" type="button" onClick={backToLogin}>Back to login</button>
              </form>
            )
          ) : (
          <form className="auth-form" onSubmit={handleLogin}>
            <label className="auth-label">Username or email</label>
            <input
              className="card-input"
              placeholder="username or email"
              value={loginForm.username}
              onChange={e => setLoginForm(f => ({ ...f, username: e.target.value }))}
              maxLength={255}
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
              maxLength={255}
              required
            />
            <button className="auth-forgot" type="button" onClick={() => { setForgotPw(true); setError('') }}>
              Forgot your password?
            </button>
            {error && <p className="auth-error">{error}</p>}
            <button className="btn-primary auth-submit" type="submit" disabled={loading}>
              {loading ? 'Logging in…' : 'Log in'}
            </button>
          </form>
          )
        ) : (
          <form className="auth-form" onSubmit={handleRegister}>
            <label className="auth-label">Username</label>
            <input
              className="card-input"
              placeholder="username"
              value={registerForm.username}
              onChange={e => setRegisterForm(f => ({ ...f, username: e.target.value }))}
              maxLength={50}
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
              maxLength={255}
              required
            />
            <label className="auth-label">Password</label>
            <input
              className="card-input"
              type="password"
              placeholder="password"
              value={registerForm.password}
              onChange={e => setRegisterForm(f => ({ ...f, password: e.target.value }))}
              maxLength={255}
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
