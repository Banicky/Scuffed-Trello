import { useState, useRef } from 'react'
import { apiFetch, uploadImage, assetUrl } from '../api.js'
import TwoFactorSection from '../components/TwoFactorSection.jsx'
import TwoFactorSetup from './TwoFactorSetup.jsx'

// Account settings: edit avatar, username and email. Reached from the dashboard
// username link and the board-view avatar.
export default function SettingsPage({ user, onUserUpdate, onBack }) {
  const [username, setUsername] = useState(user.username)
  const [email, setEmail] = useState(user.email || '')
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url || null)
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(!!user.totp_enabled)
  const [settingUp2fa, setSettingUp2fa] = useState(false) // showing the dedicated 2FA setup screen
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const fileInputRef = useRef(null)

  const monogram = (user.username[0] || '?').toUpperCase()
  const dirty =
    username.trim() !== user.username ||
    email.trim() !== (user.email || '') ||
    (avatarUrl || null) !== (user.avatar_url || null)

  async function handleAvatarSelect(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    setError('')
    setSaved(false)
    setUploading(true)
    try {
      const { url } = await uploadImage(file)
      setAvatarUrl(url)
    } catch (err) {
      setError(err.message)
    }
    setUploading(false)
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setSaved(false)
    if (!username.trim()) return setError('Username cannot be empty')
    if (!email.trim()) return setError('Email cannot be empty')

    setSaving(true)
    const res = await apiFetch('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        username: username.trim(),
        email: email.trim(),
        avatar_url: avatarUrl,
      }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) return setError(data.error)
    onUserUpdate(data)
    setSaved(true)
  }

  // Dedicated full-screen 2FA enrolment — replaces the settings view while active.
  if (settingUp2fa) {
    return (
      <TwoFactorSetup
        onCancel={() => setSettingUp2fa(false)}
        onDone={() => {
          setTwoFactorEnabled(true)
          onUserUpdate({ ...user, totp_enabled: true })
          setSettingUp2fa(false)
        }}
      />
    )
  }

  return (
    <div className="settings-shell">
      <header className="topbar">
        <div className="topbar-left">
          <button className="btn-ghost" onClick={onBack}>← Back</button>
        </div>
        <div className="topbar-right">
          <span className="board-name" style={{ cursor: 'default' }}>Account settings</span>
        </div>
      </header>

      <main className="settings-main">
       <div className="settings-stack">
        <form className="settings-card" onSubmit={handleSave}>
          <h1 className="settings-title">Your profile</h1>
          <p className="settings-sub">Update how you appear across your boards.</p>

          <div className="settings-avatar-row">
            <div className="settings-avatar">
              {avatarUrl
                ? <img src={assetUrl(avatarUrl)} alt="Profile picture" />
                : <span className="settings-avatar-monogram">{monogram}</span>}
            </div>
            <div className="settings-avatar-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleAvatarSelect}
              />
              <button
                type="button"
                className="btn-ghost"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? 'Uploading…' : avatarUrl ? 'Change photo' : 'Upload photo'}
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  className="btn-ghost settings-avatar-remove"
                  onClick={() => { setAvatarUrl(null); setSaved(false) }}
                >
                  Remove
                </button>
              )}
              <span className="settings-hint">Images only · max 5 MB</span>
            </div>
          </div>

          <label className="auth-label">Username</label>
          <input
            className="card-input"
            value={username}
            onChange={e => { setUsername(e.target.value); setSaved(false) }}
            maxLength={50}
            required
          />

          <label className="auth-label">Email</label>
          <input
            className="card-input"
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setSaved(false) }}
            maxLength={255}
            required
          />

          {error && <p className="auth-error">{error}</p>}
          {saved && !error && <p className="settings-saved">Profile updated.</p>}

          <button className="btn-primary settings-submit" type="submit" disabled={saving || uploading || !dirty}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </form>

        <section className="settings-card">
          <h2 className="settings-title settings-title--sm">Security</h2>
          <TwoFactorSection
            enabled={!!twoFactorEnabled}
            onStartSetup={() => setSettingUp2fa(true)}
            onChange={next => {
              setTwoFactorEnabled(next)
              onUserUpdate({ ...user, totp_enabled: next })
            }}
          />
        </section>
       </div>
      </main>
    </div>
  )
}
