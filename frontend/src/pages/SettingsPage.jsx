import { useState, useRef, useEffect } from 'react'
import { apiFetch, uploadImage, assetUrl, getAiKeyStatus, saveAiKey, listAiModels } from '../api.js'
import TwoFactorSection from '../components/TwoFactorSection.jsx'
import TwoFactorSetup from './TwoFactorSetup.jsx'
import Starfield from '../components/Starfield.jsx'

const AVATAR_PRESETS = [
  { key: '♈', label: 'Aries' },
  { key: '♉', label: 'Taurus' },
  { key: '♊', label: 'Gemini' },
  { key: '♋', label: 'Cancer' },
  { key: '♌', label: 'Leo' },
  { key: '♍', label: 'Virgo' },
  { key: '♎', label: 'Libra' },
  { key: '♏', label: 'Scorpio' },
  { key: '♐', label: 'Sagittarius' },
  { key: '♑', label: 'Capricorn' },
  { key: '♒', label: 'Aquarius' },
  { key: '♓', label: 'Pisces' },
]

// Three curated themes. Each renders the same GSAP cosmic-orrery format in the
// picker; `variant` decides the central body (ringed planet vs. radiant sun).
export const THEME_PRESETS = [
  { label: 'Arcane', value: 'arcane', tagline: 'Amethyst nebula', variant: 'planet', accent: '#a855f7', accBg: 'rgba(168,85,247,0.12)', accBorder: 'rgba(168,85,247,0.35)' },
  { label: 'Solar',  value: 'solar',  tagline: 'Golden corona',   variant: 'sun',    accent: '#f59e0b', accBg: 'rgba(245,158,11,0.12)', accBorder: 'rgba(245,158,11,0.38)' },
  { label: 'Aurora', value: 'aurora', tagline: 'Boreal tide',     variant: 'planet', accent: '#2dd4bf', accBg: 'rgba(45,212,191,0.12)', accBorder: 'rgba(45,212,191,0.35)' },
]

export function applyAccentTheme(value) {
  const theme = THEME_PRESETS.find(t => t.value === value) || THEME_PRESETS[0]
  const root = document.documentElement
  root.style.setProperty('--accent', theme.accent)
  root.style.setProperty('--accent-bg', theme.accBg)
  root.style.setProperty('--accent-border', theme.accBorder)
}

function AvatarSection({ user, onUpdate, guardRef }) {
  // Avatar edits are *staged* locally and only persisted when the user clicks
  // "Save Changes" — nothing hits the server on a mere preset click or file pick.
  //  · draftUrl     — pending avatar_url to save ('preset:x', a server url, or null for initials)
  //  · pendingFile  — a chosen custom image not yet uploaded
  //  · pendingPreview — object URL for previewing that pending file
  const [draftUrl, setDraftUrl] = useState(user.avatar_url ?? null)
  const [pendingFile, setPendingFile] = useState(null)
  const [pendingPreview, setPendingPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  // Re-sync the draft to the saved value whenever it changes (e.g. right after a
  // successful save), which also clears the dirty/unsaved state.
  useEffect(() => {
    setDraftUrl(user.avatar_url ?? null)
    setPendingFile(null)
    setPendingPreview(prev => { if (prev) URL.revokeObjectURL(prev); return null })
  }, [user.avatar_url])

  // Release the preview object URL on unmount so we don't leak it.
  useEffect(() => () => { if (pendingPreview) URL.revokeObjectURL(pendingPreview) }, [pendingPreview])

  const draftPresetKey = draftUrl?.startsWith('preset:') ? draftUrl.slice(7) : null
  const draftCustomUrl = pendingFile
    ? pendingPreview
    : (draftUrl && !draftUrl.startsWith('preset:') ? assetUrl(draftUrl) : null)
  const hasCustomDraft = draftCustomUrl != null
  const hasAnyAvatar = hasCustomDraft || draftPresetKey != null
  const dirty = pendingFile != null || (draftUrl ?? null) !== (user.avatar_url ?? null)

  function selectPreset(key) {
    setError('')
    setDraftUrl(`preset:${key}`)
    setPendingFile(null)
    setPendingPreview(prev => { if (prev) URL.revokeObjectURL(prev); return null })
  }

  function chooseFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setError('Image must be under 5 MB.'); return }
    setError('')
    setPendingPreview(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file) })
    setPendingFile(file)
    setDraftUrl(null) // a pending custom image supersedes any chosen preset
  }

  function useInitials() {
    setError('')
    setDraftUrl(null)
    setPendingFile(null)
    setPendingPreview(prev => { if (prev) URL.revokeObjectURL(prev); return null })
  }

  function discard() {
    setError('')
    setDraftUrl(user.avatar_url ?? null)
    setPendingFile(null)
    setPendingPreview(prev => { if (prev) URL.revokeObjectURL(prev); return null })
  }

  // Persist the staged changes. Uploads the pending file first (if any), then
  // PATCHes the user. Returns true on success so the exit guard can proceed.
  async function save() {
    if (!dirty) return true
    setSaving(true)
    setError('')
    try {
      let avatar_url = draftUrl
      if (pendingFile) {
        const { url } = await uploadImage(pendingFile, 'avatars')
        avatar_url = url
      }
      const res = await apiFetch('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ avatar_url }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onUpdate({ avatar_url: data.avatar_url }) // re-sync effect clears the dirty state
      return true
    } catch (e) {
      setError(e.message)
      return false
    } finally {
      setSaving(false)
    }
  }

  // Expose the live dirty flag + save fn to the page so it can guard navigation.
  useEffect(() => {
    guardRef.current = { dirty, save }
    return () => { guardRef.current = null }
  })

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Your Avatar</h2>
      <p className="settings-section-desc">Choose the symbol precedes your name throughout the galaxy.</p>

      <div className="settings-avatar-hero">
        {hasCustomDraft ? (
          <img className="settings-avatar-hero-img" src={draftCustomUrl} alt={user.username} />
        ) : draftPresetKey ? (
          <span className="settings-avatar-hero-sigil">{draftPresetKey}</span>
        ) : (
          <span className="settings-avatar-hero-monogram">{(user.username[0] || '?').toUpperCase()}</span>
        )}
      </div>

      <div className="settings-avatar-block">
        <h3 className="settings-block-label">Zodiac Signs</h3>
        <div className="settings-avatar-presets">
          {AVATAR_PRESETS.map(p => (
            <button
              key={p.key}
              className={`settings-avatar-preset${draftPresetKey === p.key ? ' selected' : ''}`}
              onClick={() => selectPreset(p.key)}
              disabled={saving}
              title={p.label}
              aria-label={`${p.label} sign${draftPresetKey === p.key ? ' (selected)' : ''}`}
            >
              {p.key}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-avatar-block">
        <h3 className="settings-block-label">Custom Image</h3>
        <div className="settings-avatar-upload-row">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={chooseFile} />
          <button
            className="btn-ghost"
            onClick={() => fileRef.current?.click()}
            disabled={saving}
          >
            {hasCustomDraft ? 'Replace image' : 'Upload image'}
          </button>
          {hasAnyAvatar && (
            <button
              className="btn-ghost settings-avatar-clear"
              onClick={useInitials}
              disabled={saving}
            >
              Use initials
            </button>
          )}
        </div>
        <p className="settings-avatar-hint">Images only · max 5 MB · changes apply after you save</p>
      </div>

      {error && <p className="settings-error">{error}</p>}

      <div className="settings-avatar-savebar">
        <button className="btn-primary" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        {dirty && (
          <button className="btn-ghost" onClick={discard} disabled={saving}>Discard</button>
        )}
        {dirty && <span className="settings-avatar-dirty-note">Unsaved changes</span>}
      </div>
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

function AiSection() {
  const [configured, setConfigured] = useState(false)
  const [model, setModel] = useState('')
  const [models, setModels] = useState([])
  const [keyInput, setKeyInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Load current key status + chosen model. If a key exists, also fetch the
  // model list (which itself validates the key against Anthropic).
  useEffect(() => {
    let alive = true
    getAiKeyStatus()
      .then(async s => {
        if (!alive) return
        setConfigured(s.configured)
        setModel(s.model)
        if (s.configured) {
          try {
            const list = await listAiModels()
            if (alive) setModels(list)
          } catch { /* leave model list empty; the saved model still works */ }
        }
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  async function saveKey(e) {
    e.preventDefault()
    if (!keyInput.trim()) return
    setSaving(true); setError(''); setSuccess('')
    try {
      const res = await saveAiKey({ key: keyInput.trim(), model })
      setConfigured(res.configured)
      setKeyInput('')
      setSuccess('API key saved.')
      try { setModels(await listAiModels()) } catch { /* ignore */ }
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  async function changeModel(e) {
    const next = e.target.value
    setModel(next)
    setError(''); setSuccess('')
    try {
      await saveAiKey({ model: next })
      setSuccess('Model updated.')
    } catch (err) {
      setError(err.message)
    }
  }

  async function clearKey() {
    setSaving(true); setError(''); setSuccess('')
    try {
      await saveAiKey({ key: '' })
      setConfigured(false)
      setModels([])
      setSuccess('API key removed.')
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">AI Assistant</h2>
      <p className="settings-section-desc">
        The assistant runs on your own Anthropic API key. It's stored encrypted and
        only used to power your requests. Get a key at{' '}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.
      </p>

      {loading ? (
        <p className="settings-section-desc">Loading…</p>
      ) : (
        <>
          <div className="settings-avatar-block">
            <h3 className="settings-block-label">Anthropic API Key</h3>
            <div className={`ai-key-status${configured ? ' ai-key-status--on' : ''}`}>
              {configured ? '✓ A key is configured.' : 'No key configured yet.'}
            </div>
            <form className="settings-form" onSubmit={saveKey}>
              <label className="settings-field">
                <span className="settings-field-label">{configured ? 'Replace key' : 'API key'}</span>
                <input
                  className="card-input"
                  type="password"
                  placeholder="sk-ant-…"
                  value={keyInput}
                  onChange={e => setKeyInput(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <div className="settings-avatar-upload-row">
                <button className="btn-primary" type="submit" disabled={saving || !keyInput.trim()}>
                  {saving ? 'Saving…' : 'Save key'}
                </button>
                {configured && (
                  <button type="button" className="btn-ghost settings-avatar-clear" onClick={clearKey} disabled={saving}>
                    Remove key
                  </button>
                )}
              </div>
            </form>
          </div>

          {configured && (
            <div className="settings-avatar-block">
              <h3 className="settings-block-label">Model</h3>
              <select className="card-input ai-model-select" value={model} onChange={changeModel}>
                {/* Always include the saved model even if the list didn't load. */}
                {!models.some(m => m.id === model) && <option value={model}>{model}</option>}
                {models.map(m => (
                  <option key={m.id} value={m.id}>{m.display_name || m.id}</option>
                ))}
              </select>
              <p className="settings-avatar-hint">Faster, cheaper models suit quick card edits; stronger models plan better.</p>
            </div>
          )}

          {error && <p className="settings-error">{error}</p>}
          {success && <p className="settings-success">{success}</p>}
        </>
      )}
    </div>
  )
}

function IconAi() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z" />
      <path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z" />
    </svg>
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
  { key: 'ai',             label: 'AI Assistant',    Icon: IconAi },
  { key: 'security',       label: 'Security',        Icon: IconSecurity },
]

export default function SettingsPage({ user, section, onSection, onBack, onUpdateUser, onLogout }) {
  const [settingUp2fa, setSettingUp2fa] = useState(false)
  // mirror the dashboard's day/night choice so Settings matches the realm
  const colorMode = localStorage.getItem('dash-color-mode') || 'night'

  // The active editing pane (currently the avatar) registers its unsaved-changes
  // state here. `pendingExit` holds the navigation to run once the user resolves
  // the "save or leave" prompt; `savingExit` reflects an in-flight save from it.
  const guardRef = useRef(null)
  const [pendingExit, setPendingExit] = useState(null)
  const [savingExit, setSavingExit] = useState(false)

  // Run `action`, but if there are unsaved changes first pop the guard prompt.
  function guardedExit(action) {
    if (guardRef.current?.dirty) setPendingExit({ run: action })
    else action()
  }

  async function saveAndExit() {
    setSavingExit(true)
    const ok = await guardRef.current?.save?.()
    setSavingExit(false)
    if (ok) { const a = pendingExit; setPendingExit(null); a?.run() }
    // on failure the prompt stays open; the pane shows its own error
  }

  function exitWithoutSaving() {
    const a = pendingExit
    setPendingExit(null)
    a?.run()
  }

  // Let Escape dismiss the prompt (but not while a save is in flight).
  useEffect(() => {
    if (!pendingExit) return
    function onKey(e) { if (e.key === 'Escape' && !savingExit) setPendingExit(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pendingExit, savingExit])

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
    <div className={`settings-shell${colorMode === 'day' ? ' settings-shell--day' : ''}`}>
      <Starfield mode={colorMode} />

      <header className="settings-topbar">
        <button className="back-btn" onClick={() => guardedExit(onBack)} title="Back to dashboard">←</button>
        <span className="settings-topbar-title">Settings</span>
        <button className="btn-ghost logout-btn" onClick={() => guardedExit(onLogout)}>Log out</button>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {NAV_ITEMS.map(item => (
            <button
              key={item.key}
              className={`settings-nav-item${section === item.key ? ' active' : ''}`}
              onClick={() => { if (item.key !== section) guardedExit(() => onSection(item.key)) }}
              aria-current={section === item.key ? 'page' : undefined}
            >
              <span className="settings-nav-glyph"><item.Icon /></span>
              {item.label}
            </button>
          ))}
        </nav>

        <main className="settings-pane">
          {section === 'avatar'        && <AvatarSection       user={user} onUpdate={onUpdateUser} guardRef={guardRef} />}
          {section === 'security'      && <SecuritySection user={user} onUpdateUser={onUpdateUser} onStartSetup={() => setSettingUp2fa(true)} />}
          {section === 'ai'            && <AiSection />}
        </main>
      </div>

      {pendingExit && (
        <div
          className="settings-confirm-overlay"
          onClick={() => { if (!savingExit) setPendingExit(null) }}
        >
          <div
            className="settings-confirm-card"
            role="dialog"
            aria-modal="true"
            aria-label="Unsaved changes"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="settings-confirm-title">Unsaved changes</h2>
            <p className="settings-confirm-text">
              You have unsaved changes. Save them before leaving, or exit and discard them?
            </p>
            <div className="settings-confirm-actions">
              <button className="btn-primary" onClick={saveAndExit} disabled={savingExit}>
                {savingExit ? 'Saving…' : 'Save & exit'}
              </button>
              <button className="btn-ghost" onClick={exitWithoutSaving} disabled={savingExit}>
                Exit without saving
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
