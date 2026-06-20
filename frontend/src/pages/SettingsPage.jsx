import { useState, useRef, useCallback } from 'react'
import { apiFetch, uploadImage, assetUrl } from '../api.js'
import { hexToRgb } from '../utils.js'
import TwoFactorSection from '../components/TwoFactorSection.jsx'
import TwoFactorSetup from './TwoFactorSetup.jsx'
import Starfield from '../components/Starfield.jsx'

const AVATAR_PRESETS = [
  { key: '⚔', label: 'Knight' },
  { key: '🔮', label: 'Oracle' },
  { key: '🐉', label: 'Dragon' },
  { key: '🏰', label: 'Warden' },
  { key: '🧙', label: 'Mage' },
  { key: '⚡', label: 'Stormcaller' },
  { key: '🛡', label: 'Guardian' },
  { key: '🌙', label: 'Moonsworn' },
  { key: '💫', label: 'Wanderer' },
  { key: '🌟', label: 'Starborn' },
  { key: '🦁', label: 'Lionheart' },
  { key: '🌿', label: 'Verdant' },
]

export const ACCENT_THEMES = [
  { label: 'Arcane',  value: 'arcane',  accent: '#a855f7', accBg: 'rgba(168,85,247,0.12)',  accBorder: 'rgba(168,85,247,0.35)' },
  { label: 'Ember',   value: 'ember',   accent: '#e05a2b', accBg: 'rgba(224,90,43,0.12)',   accBorder: 'rgba(224,90,43,0.35)'  },
  { label: 'Verdant', value: 'verdant', accent: '#16a34a', accBg: 'rgba(22,163,74,0.12)',   accBorder: 'rgba(22,163,74,0.35)'  },
  { label: 'Tidal',   value: 'tidal',   accent: '#0ea5e9', accBg: 'rgba(14,165,233,0.12)',  accBorder: 'rgba(14,165,233,0.35)' },
  { label: 'Gilded',  value: 'gilded',  accent: '#ca8a04', accBg: 'rgba(202,138,4,0.12)',   accBorder: 'rgba(202,138,4,0.35)'  },
]

export function applyAccentTheme(value, userId) {
  if (value === 'custom') {
    const hex = userId ? localStorage.getItem(`accent-custom-${userId}`) : null
    if (hex) applyCustomAccent(hex)
    return
  }
  const theme = ACCENT_THEMES.find(t => t.value === value)
  if (!theme) return
  const root = document.documentElement
  root.style.setProperty('--accent', theme.accent)
  root.style.setProperty('--accent-bg', theme.accBg)
  root.style.setProperty('--accent-border', theme.accBorder)
}

function applyCustomAccent(hex) {
  const [r, g, b] = hexToRgb(hex)
  const root = document.documentElement
  root.style.setProperty('--accent', hex)
  root.style.setProperty('--accent-bg', `rgba(${r},${g},${b},0.12)`)
  root.style.setProperty('--accent-border', `rgba(${r},${g},${b},0.35)`)
}

function AvatarSection({ user, onUpdate }) {
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  const isPreset = user.avatar_url?.startsWith('preset:')
  const currentPresetKey = isPreset ? user.avatar_url.slice(7) : null
  const hasCustomImage = user.avatar_url && !isPreset

  async function selectPreset(key) {
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ avatar_url: `preset:${key}` }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onUpdate({ avatar_url: data.avatar_url })
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  async function uploadCustom(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const { url } = await uploadImage(file)
      const res = await apiFetch('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ avatar_url: url }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onUpdate({ avatar_url: data.avatar_url })
    } catch (e) {
      setError(e.message)
    }
    setUploading(false)
  }

  async function clearAvatar() {
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ avatar_url: null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onUpdate({ avatar_url: null })
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Your Sigil</h2>
      <p className="settings-section-desc">Choose the mark that precedes your name throughout the realm.</p>

      <div className="settings-avatar-hero">
        {hasCustomImage ? (
          <img className="settings-avatar-hero-img" src={assetUrl(user.avatar_url)} alt={user.username} />
        ) : currentPresetKey ? (
          <span className="settings-avatar-hero-sigil">{currentPresetKey}</span>
        ) : (
          <span className="settings-avatar-hero-monogram">{(user.username[0] || '?').toUpperCase()}</span>
        )}
      </div>

      <div className="settings-avatar-block">
        <h3 className="settings-block-label">Arcane Sigils</h3>
        <div className="settings-avatar-presets">
          {AVATAR_PRESETS.map(p => (
            <button
              key={p.key}
              className={`settings-avatar-preset${currentPresetKey === p.key ? ' selected' : ''}`}
              onClick={() => selectPreset(p.key)}
              disabled={saving || uploading}
              title={p.label}
              aria-label={`${p.label} sigil${currentPresetKey === p.key ? ' (active)' : ''}`}
            >
              {p.key}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-avatar-block">
        <h3 className="settings-block-label">Custom Image</h3>
        <div className="settings-avatar-upload-row">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={uploadCustom} />
          <button
            className="btn-ghost"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || saving}
          >
            {uploading ? 'Uploading…' : hasCustomImage ? 'Replace image' : 'Upload image'}
          </button>
          {user.avatar_url && (
            <button
              className="btn-ghost settings-avatar-clear"
              onClick={clearAvatar}
              disabled={saving || uploading}
            >
              Use initials
            </button>
          )}
        </div>
        <p className="settings-avatar-hint">Images only · max 5 MB</p>
      </div>

      {error && <p className="settings-error">{error}</p>}
    </div>
  )
}

function SecuritySection({ user, onUpdateUser, onStartSetup }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess(false)
    if (newPassword !== confirm) return setError('New passwords do not match.')
    if (newPassword.length < 6) return setError('New password must be at least 6 characters.')
    setSaving(true)
    try {
      const res = await apiFetch('/api/users/password', {
        method: 'POST',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Security</h2>
      <p className="settings-section-desc">Change your password. Other active sessions stay signed in.</p>

      <form className="settings-form" onSubmit={handleSubmit}>
        <label className="settings-field">
          <span className="settings-field-label">Current password</span>
          <input
            className="card-input"
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">New password</span>
          <input
            className="card-input"
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={6}
          />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">Confirm new password</span>
          <input
            className="card-input"
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        {error && <p className="settings-error">{error}</p>}
        {success && <p className="settings-success">Password changed.</p>}
        <button className="btn-primary" type="submit" disabled={saving} style={{ alignSelf: 'flex-start' }}>
          {saving ? 'Changing…' : 'Change password'}
        </button>
      </form>

      <TwoFactorSection
        enabled={!!user.totp_enabled}
        onStartSetup={onStartSetup}
        onChange={next => onUpdateUser({ totp_enabled: next })}
      />
    </div>
  )
}

function CustomizationSection({ userId }) {
  const [activeTheme, setActiveTheme] = useState(
    () => localStorage.getItem(`accent-theme-${userId}`) || 'arcane'
  )
  const [customHex, setCustomHex] = useState(
    () => localStorage.getItem(`accent-custom-${userId}`) || '#a855f7'
  )
  const [reducedMotion, setReducedMotion] = useState(
    () => localStorage.getItem('force-reduced-motion') === 'true'
  )
  const colorInputRef = useRef(null)

  function selectTheme(value) {
    setActiveTheme(value)
    localStorage.setItem(`accent-theme-${userId}`, value)
    applyAccentTheme(value, userId)
  }

  const handleCustomColor = useCallback((e) => {
    const hex = e.target.value
    setCustomHex(hex)
    setActiveTheme('custom')
    localStorage.setItem(`accent-custom-${userId}`, hex)
    localStorage.setItem(`accent-theme-${userId}`, 'custom')
    applyCustomAccent(hex)
  }, [userId])

  function toggleReducedMotion(e) {
    const val = e.target.checked
    setReducedMotion(val)
    localStorage.setItem('force-reduced-motion', String(val))
    if (val) {
      document.documentElement.classList.add('force-reduced-motion')
    } else {
      document.documentElement.classList.remove('force-reduced-motion')
    }
  }

  const activeLabel = activeTheme === 'custom'
    ? `Custom · ${customHex}`
    : (ACCENT_THEMES.find(t => t.value === activeTheme)?.label ?? 'Arcane')

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Customization</h2>
      <p className="settings-section-desc">Shape how the realm looks to you. Preferences are saved to this device.</p>

      <div className="settings-avatar-block">
        <h3 className="settings-block-label">Accent colour</h3>
        <div className="settings-theme-row">
          {ACCENT_THEMES.map(t => (
            <button
              key={t.value}
              className={`settings-theme-swatch${activeTheme === t.value ? ' selected' : ''}`}
              style={{ '--swatch': t.accent }}
              onClick={() => selectTheme(t.value)}
              title={t.label}
              aria-label={`${t.label} theme${activeTheme === t.value ? ' (active)' : ''}`}
            />
          ))}
          <button
            className={`settings-theme-swatch settings-theme-swatch--custom${activeTheme === 'custom' ? ' selected' : ''}`}
            style={{ '--swatch': customHex }}
            onClick={() => colorInputRef.current?.click()}
            title="Custom colour"
            aria-label={`Custom colour${activeTheme === 'custom' ? ' (active)' : ''}`}
          >
            {activeTheme !== 'custom' && <span className="settings-swatch-plus">+</span>}
          </button>
          <input
            ref={colorInputRef}
            type="color"
            value={customHex}
            onChange={handleCustomColor}
            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
            tabIndex={-1}
            aria-hidden="true"
          />
        </div>
        <p className="settings-avatar-hint">{activeLabel} · applies to buttons, links, and highlights</p>
      </div>

      <div className="settings-avatar-block">
        <h3 className="settings-block-label">Motion</h3>
        <label className="settings-toggle-row">
          <span className="settings-toggle-label">
            <strong>Reduce motion</strong>
            <span className="settings-toggle-sub">Turns off portal particles, the sky comet, and tile entrance animations</span>
          </span>
          <input
            type="checkbox"
            className="settings-toggle"
            checked={reducedMotion}
            onChange={toggleReducedMotion}
          />
        </label>
      </div>
    </div>
  )
}

function IconAvatar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  )
}

function IconCustomization() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <circle cx="8" cy="6" r="2" fill="var(--bg)" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="16" cy="12" r="2" fill="var(--bg)" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="10" cy="18" r="2" fill="var(--bg)" />
    </svg>
  )
}

function IconSecurity() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" />
    </svg>
  )
}

const NAV_ITEMS = [
  { key: 'avatar',         label: 'Change Avatar',  Icon: IconAvatar },
  { key: 'customization',  label: 'Customization',   Icon: IconCustomization },
  { key: 'security',       label: 'Security',        Icon: IconSecurity },
]

export default function SettingsPage({ user, section, onSection, onBack, onUpdateUser, onLogout }) {
  const [settingUp2fa, setSettingUp2fa] = useState(false)

  // 2FA enrolment is its own full-screen flow, so it replaces the whole
  // settings shell rather than rendering inside a pane.
  if (settingUp2fa) {
    return (
      <TwoFactorSetup
        onDone={() => { onUpdateUser({ totp_enabled: true }); setSettingUp2fa(false) }}
        onCancel={() => setSettingUp2fa(false)}
      />
    )
  }

  return (
    <div className="settings-shell">
      <Starfield />

      <header className="settings-topbar">
        <button className="back-btn" onClick={onBack} title="Back to dashboard">←</button>
        <span className="settings-topbar-title">Settings</span>
        <button className="btn-ghost logout-btn" onClick={onLogout}>Log out</button>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {NAV_ITEMS.map(item => (
            <button
              key={item.key}
              className={`settings-nav-item${section === item.key ? ' active' : ''}`}
              onClick={() => onSection(item.key)}
              aria-current={section === item.key ? 'page' : undefined}
            >
              <span className="settings-nav-glyph"><item.Icon /></span>
              {item.label}
            </button>
          ))}
        </nav>

        <main className="settings-pane">
          {section === 'avatar'        && <AvatarSection       user={user} onUpdate={onUpdateUser} />}
          {section === 'security'      && <SecuritySection user={user} onUpdateUser={onUpdateUser} onStartSetup={() => setSettingUp2fa(true)} />}
          {section === 'customization' && <CustomizationSection userId={user.id} />}
        </main>
      </div>
    </div>
  )
}
