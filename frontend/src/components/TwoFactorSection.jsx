import { useState } from 'react'
import { apiFetch } from '../api.js'

// Two-factor (TOTP) summary in account settings.
//   - When disabled: an "Enable" button that hands off to the dedicated setup
//     screen via onStartSetup.
//   - When enabled:  a "Disable" button → confirm inline with a current code.
// `onChange(next)` reports the new enabled state upward.
export default function TwoFactorSection({ enabled, onStartSetup, onChange }) {
  const [disabling, setDisabling] = useState(false)
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function resetDisable() {
    setDisabling(false); setToken(''); setError(''); setBusy(false)
  }

  async function confirmDisable(e) {
    e.preventDefault()
    setError(''); setBusy(true)
    const res = await apiFetch('/api/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ token: token.trim() }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) return setError(data.error || 'Could not disable 2FA')
    onChange(false)
    resetDisable()
  }

  return (
    <div className="twofa-section">
      <div className="twofa-head">
        <div>
          <p className="twofa-title">Two-factor authentication</p>
          <p className="twofa-sub">
            {enabled
              ? 'Enabled — you enter a code from your authenticator app at login.'
              : 'Add a code from an authenticator app (Google Authenticator, Authy…) at login.'}
          </p>
        </div>
        <span className={`twofa-badge${enabled ? ' on' : ''}`}>{enabled ? 'On' : 'Off'}</span>
      </div>

      {!enabled && !disabling && (
        <button type="button" className="btn-primary twofa-btn" onClick={onStartSetup}>
          Enable 2FA
        </button>
      )}

      {enabled && !disabling && (
        <button type="button" className="btn-ghost twofa-danger" onClick={() => { setError(''); setDisabling(true) }}>
          Disable 2FA
        </button>
      )}

      {disabling && (
        <form className="twofa-panel" onSubmit={confirmDisable}>
          <p className="twofa-step">Enter a current code to turn off 2FA:</p>
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
            <button className="btn-danger-sm" type="submit" disabled={busy || !token.trim()}>
              {busy ? 'Disabling…' : 'Disable 2FA'}
            </button>
            <button className="btn-ghost" type="button" onClick={resetDisable}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}
