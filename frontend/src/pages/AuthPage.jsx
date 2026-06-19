import { useState, useEffect } from 'react'
import { apiFetch, API_BASE } from '../api.js'

export default function AuthPage({ onLogin }) {
  const [tab, setTab] = useState('login')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [forgotPw, setForgotPw] = useState(false)
  const [resetForm, setResetForm] = useState({ username: '', newPassword: '', confirmPassword: '' })
  const [resetSuccess, setResetSuccess] = useState(false)
  const [providers, setProviders] = useState({ google: false, github: false })
  const [twoFactor, setTwoFactor] = useState(false) // login is awaiting a TOTP code
  const [twoFactorToken, setTwoFactorToken] = useState('')
  const [rememberDevice, setRememberDevice] = useState(false)

  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [registerForm, setRegisterForm] = useState({ username: '', email: '', password: '' })

  // Which OAuth buttons to show — the backend only enables providers that are
  // configured with client credentials.
  useEffect(() => {
    apiFetch('/api/auth/providers')
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (data) setProviders(data) })
      .catch(() => {})
  }, [])

  // Surface an OAuth failure that redirected back with ?oauth_error=<provider>.
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
    const failed = params.get('oauth_error')
    if (failed) {
      setError(`Couldn't sign in with ${failed}. Please try again.`)
      window.history.replaceState(null, '', window.location.pathname + '#/')
    }
  }, [])

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
    // Account has 2FA: switch to the code-entry step instead of logging in.
    if (data.twoFactorRequired) {
      setTwoFactor(true)
      setTwoFactorToken('')
      return
    }
    onLogin(data)
  }

  async function handleTwoFactor(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await apiFetch('/api/auth/2fa/login', {
      method: 'POST',
      body: JSON.stringify({ token: twoFactorToken.trim(), remember: rememberDevice }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) return setError(data.error)
    onLogin(data)
  }

  function cancelTwoFactor() {
    setTwoFactor(false)
    setTwoFactorToken('')
    setRememberDevice(false)
    setError('')
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

  const hasOAuth = providers.google || providers.github
  const oauthBlock = hasOAuth && (
    <div className="auth-oauth">
      <div className="auth-divider"><span>or</span></div>
      {providers.google && (
        <a className="btn-oauth" href={`${API_BASE}/api/auth/google`}>
          <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
            <path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
          </svg>
          Sign in with Google
        </a>
      )}
      {providers.github && (
        <a className="btn-oauth" href={`${API_BASE}/api/auth/github`}>
          <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
          Sign in with GitHub
        </a>
      )}
    </div>
  )

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
          twoFactor ? (
            <form className="auth-form" onSubmit={handleTwoFactor}>
              <p className="auth-2fa-prompt">Enter the 6-digit code from your authenticator app.</p>
              <label className="auth-label">Authentication code</label>
              <input
                className="card-input"
                value={twoFactorToken}
                onChange={e => setTwoFactorToken(e.target.value)}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                required
              />
              <label className="auth-remember">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={e => setRememberDevice(e.target.checked)}
                />
                Remember this device for 30 days
              </label>
              {error && <p className="auth-error">{error}</p>}
              <button className="btn-primary auth-submit" type="submit" disabled={loading || !twoFactorToken.trim()}>
                {loading ? 'Verifying…' : 'Verify'}
              </button>
              <button className="auth-forgot" type="button" onClick={cancelTwoFactor}>Back to login</button>
            </form>
          ) : forgotPw ? (
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
            <label className="auth-label">Username / Email</label>
            <input
              className="card-input"
              placeholder="Enter username or email"
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
              placeholder="Enter password"
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
            {oauthBlock}
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
            {oauthBlock}
          </form>
        )}
      </div>
      </div>
    </div>
  )
}
