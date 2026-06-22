import { useState, useEffect } from 'react'
import { apiFetch } from '../api.js'

// Dedicated full-screen 2FA enrolment: scan the QR (or enter the key), then
// confirm a 6-digit code. Reached from the Security section's "Enable 2FA"
// button. `onDone(true)` on success, `onCancel` to back out.
export default function TwoFactorSetup({ onDone, onCancel }) {
  const [setup, setSetup] = useState(null) // { qr, secret }
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

  // Kick off enrolment once on mount: the backend mints a secret + QR.
  useEffect(() => {
    let cancelled = false
    apiFetch('/api/auth/2fa/setup', { method: 'POST' })
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok) { setError(data.error || 'Could not start setup'); setLoadFailed(true); return }
        setSetup(data)
      })
      .catch(() => { if (!cancelled) { setError('Could not start setup'); setLoadFailed(true) } })
    return () => { cancelled = true }
  }, [])

  async function confirmEnable(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const res = await apiFetch('/api/auth/2fa/enable', {
      method: 'POST',
      body: JSON.stringify({ token: token.trim() }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) return setError(data.error || 'Verification failed')
    onDone(true)
  }

  return (
    <div className="settings-shell">
      <header className="topbar">
        <div className="topbar-left">
          <button className="btn-ghost" onClick={onCancel}>← Back</button>
        </div>
        <div className="topbar-right">
          <span className="board-name" style={{ cursor: 'default' }}>Set up two-factor auth</span>
        </div>
      </header>

      <main className="settings-main">
        <form className="settings-card twofa-setup-card" onSubmit={confirmEnable}>
          <h1 className="settings-title">Set up two-factor authentication</h1>
          <p className="settings-sub">
            Scan the code with an authenticator app, then enter the 6-digit code it shows.
          </p>

          {loadFailed ? (
            <p className="auth-error">{error}</p>
          ) : !setup ? (
            <p className="twofa-step">Preparing your code…</p>
          ) : (
            <div className="twofa-panel">
              <p className="twofa-step">1. Scan this with your authenticator app:</p>
              <img className="twofa-qr" src={setup.qr} alt="2FA QR code" />
              <p className="twofa-step">Or enter this key manually:</p>
              <code className="twofa-secret">{setup.secret}</code>
              <p className="twofa-step">2. Enter the 6-digit code it shows:</p>
              <input
                className="card-input twofa-code"
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
              />
              {error && <p className="auth-error">{error}</p>}
              <div className="twofa-actions">
                <button className="btn-primary" type="submit" disabled={busy || !token.trim()}>
                  {busy ? 'Verifying…' : 'Verify & enable'}
                </button>
                <button className="btn-ghost" type="button" onClick={onCancel}>Cancel</button>
              </div>
            </div>
          )}
        </form>
      </main>
    </div>
  )
}
