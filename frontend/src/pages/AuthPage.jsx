import { useState, useEffect, useMemo } from 'react'
import { apiFetch, API_BASE } from '../api.js'
import Starfield from '../components/Starfield.jsx'
import { ZODIAC_CONSTELLATIONS } from '../constants.js'

const rand = (min, max) => min + Math.random() * (max - min)

// Build a fresh decorative sky for the form rail: a couple of randomly-chosen
// zodiac constellations plus scattered lone stars, each at a random position,
// size, tilt and twinkle phase. Computed once per mount (via useMemo) so it
// differs on every page load but stays stable across re-renders. All of it is
// anchored near the right edge so it sits behind the frosted rail and reads
// softly through its blur. (x in px from the rail's right edge, y in %.)
function buildAuthSky() {
  const signs = [...ZODIAC_CONSTELLATIONS]
  for (let i = signs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[signs[i], signs[j]] = [signs[j], signs[i]]
  }
  const constellations = signs.slice(0, 2 + Math.floor(Math.random() * 2)).map((sign, i) => ({
    key: `c${i}`,
    sign,
    right: rand(-24, 120),
    top: rand(3, 68),
    size: rand(150, 200),
    rotate: rand(-22, 22),
    opacity: rand(0.62, 0.95),
    stars: sign.points.map(() => ({
      td: rand(0, 3.2).toFixed(2),    // twinkle (opacity) phase
      sd: rand(0, 8).toFixed(2),      // sparkle (scale flare) phase
      dur: rand(2.6, 3.8).toFixed(2), // twinkle duration
    })),
  }))
  const stars = Array.from({ length: 7 + Math.floor(Math.random() * 5) }, (_, i) => ({
    key: `s${i}`,
    right: rand(8, 230),
    top: rand(3, 95),
    r: rand(0.8, 1.9),
    td: rand(0, 3.2).toFixed(2),
    sd: rand(0, 8).toFixed(2),
    dur: rand(2.6, 4).toFixed(2),
  }))
  return { constellations, stars }
}

// A faint, twinkling zodiac star-chain — the same constellation motif drawn on
// the dashboard's board tiles, reused behind the auth form for depth.
function AuthConstellation({ data }) {
  const { sign, right, top, size, rotate, opacity, stars } = data
  return (
    <svg
      className="auth-decor-constellation"
      viewBox="0 0 100 100"
      aria-hidden="true"
      style={{ right: `${right}px`, top: `${top}%`, width: `${size}px`, height: `${size}px`, opacity, transform: `rotate(${rotate}deg)` }}
    >
      <polyline className="auth-decor-line" points={sign.points.map(([x, y]) => `${x},${y}`).join(' ')} />
      {sign.points.map(([x, y], i) => (
        <circle
          key={i}
          className="auth-decor-star"
          cx={x}
          cy={y}
          r={i % 3 === 0 ? 1.7 : 1.2}
          style={{ animationDelay: `${stars[i].td}s, ${stars[i].sd}s`, animationDuration: `${stars[i].dur}s, 8s` }}
        />
      ))}
    </svg>
  )
}

// Product highlights for the left "landing" panel — each becomes a glowing node
// on a vertical constellation that advertises what Scuffed Trello actually does.
const FEATURES = [
  {
    title: 'Galaxies of work',
    desc: 'Spin up boards of columns and cards, then drag tasks across the void.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="5" height="16" rx="1.5" />
        <rect x="9.5" y="4" width="5" height="11" rx="1.5" />
        <rect x="16" y="4" width="5" height="14" rx="1.5" />
      </svg>
    ),
  },
  {
    title: 'Forge alliances',
    desc: 'Invite your crew to shared boards and see who’s online, in real time.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    title: 'An AI co-pilot',
    desc: 'Ask it to plan a sprint or shuffle cards — it acts on your board for you.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3l1.7 5L19 9.7l-5.3 1.6L12 16.7l-1.7-5.4L5 9.7 10.3 8z" />
        <path d="M18.6 15.4l.6 1.9 2 .6-2 .6-.6 2-.6-2-2-.6 2-.6z" />
      </svg>
    ),
  },
  {
    title: 'Chart your streak',
    desc: 'Daily voyages earn cosmic ranks, from Stardust Drifter to Galactic Voyager.',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2c1 3-1 4-2 6-1.4 2.8.4 4.8 2 4.8 1.2 0 2.1-1 1.9-2.4 1.6 1 2.6 2.7 2.6 4.4A6.4 6.4 0 0 1 5.6 15c0-3 1.9-4.6 3-7 .8-1.9 2.4-3.9 3.4-6z" />
      </svg>
    ),
  },
]

// A stylized peek at the real product — a kanban board of columns + cards, used
// as a floating mockup on the landing panel. Colors echo the board palette.
const MOCK_COLUMNS = [
  { name: 'To chart', color: '#f59e0b', cards: [{ w: ['82%', '54%'] }, { w: ['64%'] }] },
  { name: 'In orbit', color: '#8b5cf6', cards: [{ w: ['72%', '42%'], accent: true }, { w: ['80%'] }] },
  { name: 'Landed',   color: '#10b981', cards: [{ w: ['60%'] }, { w: ['74%', '46%'] }] },
]

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

  // Match whichever realm (day / night) the user last chose on the dashboard so
  // the front door feels like the same cosmos they left. New visitors get night.
  // Toggling here persists the choice so the dashboard opens in the same realm.
  const [colorMode, setColorMode] = useState(() => localStorage.getItem('dash-color-mode') || 'night')

  function toggleColorMode() {
    const next = colorMode === 'night' ? 'day' : 'night'
    localStorage.setItem('dash-color-mode', next)
    setColorMode(next)
  }

  // A freshly randomized constellation sky, generated once per page load.
  const decor = useMemo(() => buildAuthSky(), [])

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

  // Cosmic brand mark — the four-point compass star echoed across the dashboard
  // (hero filigree, section titles, ranks), set in the accent badge.
  const brandMark = (
    <span className="board-icon board-icon--brand auth-brand-mark" style={{ width: 'calc(36 * var(--u))', height: 'calc(36 * var(--u))', borderRadius: 'calc(10 * var(--u))' }}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M12 0 L13.6 10.4 L24 12 L13.6 13.6 L12 24 L10.4 13.6 L0 12 L10.4 10.4 Z" fill="currentColor" />
      </svg>
    </span>
  )

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
    <div className={`auth-shell${colorMode === 'day' ? ' auth-shell--day' : ''}`}>
      <Starfield mode={colorMode} randomConstellations />

      <button
        className="dash-mode-toggle auth-mode-toggle"
        onClick={toggleColorMode}
        aria-label={colorMode === 'day' ? 'Switch to night mode' : 'Switch to day mode'}
        title={colorMode === 'day' ? 'Night mode' : 'Day mode'}
      >
        <span className="dash-mode-toggle-icon">
          {colorMode === 'day' ? (
            // currently day → offer the moon
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          ) : (
            // currently night → offer the sun
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          )}
        </span>
      </button>
      {/* constellations + lone stars live in the background (behind the form
          rail) so the frosted pane blurs them through its backdrop-filter — the
          same way the dashboard hero card softens the starfield behind its
          glass. Positions/twinkles are randomized per page load. */}
      <div className="auth-bg-decor" aria-hidden="true">
        {decor.constellations.map(c => (
          <AuthConstellation key={c.key} data={c} />
        ))}
        {decor.stars.map(s => (
          <span
            key={s.key}
            className="auth-sky-star"
            style={{
              right: `${s.right.toFixed(1)}px`,
              top: `${s.top.toFixed(1)}%`,
              width: `${(s.r * 2).toFixed(1)}px`,
              height: `${(s.r * 2).toFixed(1)}px`,
              animationDelay: `${s.td}s, ${s.sd}s`,
              animationDuration: `${s.dur}s, 8s`,
            }}
          />
        ))}
      </div>
      <div className="auth-visual">
        <div className="auth-visual-brand">
          {brandMark}
          <span className="auth-brand">Scuffed Trello</span>
        </div>

        <p className="auth-eyebrow">Cosmic task management</p>
        <h1 className="auth-visual-heading">Organize anything into a <span className="auth-accent-word">universe</span> worth exploring.</h1>
        <p className="auth-visual-sub">Boards become galaxies, your team becomes an alliance, and tasks become quests — a project tracker that actually pulls you back in.</p>

        <ul className="auth-features">
          {FEATURES.map(f => (
            <li className="auth-feature" key={f.title}>
              <span className="auth-feature-node">{f.icon}</span>
              <span className="auth-feature-text">
                <span className="auth-feature-title">{f.title}</span>
                <span className="auth-feature-desc">{f.desc}</span>
              </span>
            </li>
          ))}
        </ul>

        {/* a floating peek at the actual product — a tilted kanban board paired
            with a streak / cosmic-rank card. Shown only on wide screens (see
            CSS), fully inside the panel and clear of the form rail. */}
        <div className="auth-mockups" aria-hidden="true">
          <div className="abm-glass abm-window">
            <div className="abm-titlebar">
              <span className="abm-dot" />
              <span className="abm-dot" />
              <span className="abm-dot" />
              <span className="abm-title">Nebula Sprint</span>
            </div>
            <div className="abm-board">
              {MOCK_COLUMNS.map(col => (
                <div className="abm-col" key={col.name}>
                  <div className="abm-col-head">
                    <span className="abm-col-dot" style={{ background: col.color }} />
                    <span className="abm-col-name">{col.name}</span>
                  </div>
                  {col.cards.map((card, i) => (
                    <div className={`abm-card${card.accent ? ' abm-card--accent' : ''}`} key={i}>
                      <span className="abm-tag" style={{ background: col.color }} />
                      {card.w.map((w, j) => (
                        <span className="abm-line" style={{ width: w }} key={j} />
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* secondary mock — the streak / cosmic-rank card (gamification) */}
          <div className="abm-glass asc-card">
            <span className="asc-flame">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2c1 3-1 4-2 6-1.4 2.8.4 4.8 2 4.8 1.2 0 2.1-1 1.9-2.4 1.6 1 2.6 2.7 2.6 4.4A6.4 6.4 0 0 1 5.6 15c0-3 1.9-4.6 3-7 .8-1.9 2.4-3.9 3.4-6z" />
              </svg>
            </span>
            <div className="asc-stat">
              <span className="asc-num">12</span>
              <span className="asc-label">days active</span>
            </div>
            <div className="asc-dots">
              {Array.from({ length: 7 }).map((_, i) => (
                <span key={i} className={`asc-dot${i < 5 ? ' asc-dot--on' : ''}`} />
              ))}
            </div>
            <div className="asc-rank"><span className="asc-rank-glyph">✦</span> Starfarer</div>
          </div>

          {/* third mock — the AI co-pilot chat */}
          <div className="abm-glass aic-card">
            <div className="aic-head">
              <span className="aic-spark">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3l1.7 5L19 9.7l-5.3 1.6L12 16.7l-1.7-5.4L5 9.7 10.3 8z" />
                </svg>
              </span>
              <span className="aic-title">AI co-pilot</span>
            </div>
            <div className="aic-bubble aic-bubble--user">Plan my sprint</div>
            <div className="aic-bubble aic-bubble--ai">
              <span className="aic-line" style={{ width: '92%' }} />
              <span className="aic-line" style={{ width: '58%' }} />
            </div>
          </div>
        </div>
      </div>

      <div className="auth-form-panel">
      <div className="auth-decor" aria-hidden="true">
        {/* soft accent glow pooling at the top of the rail */}
        <span className="auth-decor-glow" />
        {/* corner filigree — the dashboard hero's ornament, mirrored into the
            top-right corner to frame the rail */}
        <svg className="auth-decor-corner" viewBox="0 0 120 120" fill="none">
          <path className="dhc-line" d="M24 92 L24 32 Q24 24 32 24 L92 24" />
          <path className="dhc-line dhc-line--faint" d="M36 100 L36 42 Q36 36 42 36 L100 36" />
          <path className="dhc-arc" d="M104 28 A76 76 0 0 0 28 104" />
          <path className="dhc-star dhc-star--lg" d="M24 5 L26 22 L43 24 L26 26 L24 43 L22 26 L5 24 L22 22 Z" />
          <circle className="dhc-dot" cx="60" cy="50" r="1.2" />
          <circle className="dhc-dot" cx="98" cy="64" r="1.4" />
        </svg>
      </div>
      <div className="auth-card">
        <div className="auth-mobile-brand">
          {brandMark}
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
