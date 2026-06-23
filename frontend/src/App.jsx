import { useState, useEffect, useCallback } from 'react'
import './App.css'
import { apiFetch } from './api.js'
import AuthPage from './pages/AuthPage.jsx'
import Dashboard from './pages/Dashboard.jsx'
import BoardView from './pages/BoardView.jsx'
import PortalTransition from './components/PortalTransition.jsx'
import SettingsPage, { applyAccentTheme } from './pages/SettingsPage.jsx'

// Derive the current route from the URL hash so it survives a page refresh.
// #/board/<id> → a board, else → the dashboard. (Settings is overlaid via state.)
function parseHash() {
  const match = window.location.hash.match(/^#\/board\/(\d+)/)
  if (match) return { view: 'board', boardId: Number(match[1]) }
  return { view: 'dashboard', boardId: null }
}

export default function App() {
  const [status, setStatus] = useState('loading') // loading | auth | ready
  const [user, setUser] = useState(null)
  const [route, setRoute] = useState(parseHash)
  const [portal, setPortal] = useState(null) // { color } while opening a board
  const [boardReady, setBoardReady] = useState(false) // board has rendered behind the portal
  const [settingsSection, setSettingsSection] = useState(null) // null | 'avatar' | 'security' | 'customization'

  useEffect(() => {
    apiFetch('/api/auth/me').then(res => {
      if (res.ok) return res.json().then(u => {
        setUser(u)
        setStatus('ready')
        // restore accent theme only when the user is confirmed logged in
        const theme = localStorage.getItem(`accent-theme-${u.id}`)
        if (theme) applyAccentTheme(theme)
        if (localStorage.getItem('force-reduced-motion') === 'true') {
          document.documentElement.classList.add('force-reduced-motion')
        }
      })
      setStatus('auth')
    }).catch(() => setStatus('auth'))
  }, [])

  // Keep the route in sync with browser navigation (refresh, back/forward).
  useEffect(() => {
    function onHashChange() { setRoute(parseHash()) }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Presence heartbeat: while logged in, ping the server every 30s (and on
  // regaining focus) so board member lists can flag who is currently active.
  // Lives at the app root so it runs on the dashboard and inside a board alike.
  useEffect(() => {
    if (status !== 'ready') return
    const ping = () => apiFetch('/api/heartbeat', { method: 'POST' }).catch(() => {})
    ping()
    const id = setInterval(ping, 30000)
    const onVisible = () => { if (!document.hidden) ping() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [status])

  function handleLogin(u) {
    setUser(u)
    setStatus('ready')
    // apply the user's saved accent theme now that they're authenticated
    const theme = localStorage.getItem(`accent-theme-${u.id}`)
    if (theme) applyAccentTheme(theme)
    if (localStorage.getItem('force-reduced-motion') === 'true') {
      document.documentElement.classList.add('force-reduced-motion')
    }
  }

  async function handleLogout() {
    await apiFetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    window.location.hash = '#/'
    // reset to default theme so the login page is always the site default
    applyAccentTheme('arcane')
    document.documentElement.classList.remove('force-reduced-motion')
    setStatus('auth')
  }

  function openBoard(boardId, color) {
    setBoardReady(false)
    setPortal({ color: color || '#c084fc' })
    window.location.hash = `#/board/${boardId}`
  }

  // BoardView fires this once its content has painted, so the portal can hold
  // the veil opaque over the heavy first render, then fade to reveal it.
  const handleBoardReady = useCallback(() => setBoardReady(true), [])

  function goDashboard() {
    window.location.hash = '#/'
  }

  function openSettings(section) {
    setSettingsSection(section)
  }

  function closeSettings() {
    setSettingsSection(null)
  }

  const portalEl = portal && (
    <PortalTransition color={portal.color} ready={boardReady} onDone={() => setPortal(null)} />
  )

  if (settingsSection) return (
    <SettingsPage
      user={user}
      section={settingsSection}
      onSection={setSettingsSection}
      onBack={closeSettings}
      onUpdateUser={updates => setUser(prev => ({ ...prev, ...updates }))}
      onLogout={handleLogout}
    />
  )

  if (status === 'loading') {
    return (
      <div className="app-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}>
        Loading…
      </div>
    )
  }

  if (status === 'auth') return <AuthPage onLogin={handleLogin} />

  if (route.view === 'board') return (
    <>
      <BoardView
        boardId={route.boardId}
        user={user}
        onBack={goDashboard}
        onReady={handleBoardReady}
        onOpenSettings={openSettings}
      />
      {portalEl}
    </>
  )

  return (
    <>
      <Dashboard
        user={user}
        onOpenBoard={openBoard}
        onLogout={handleLogout}
        onOpenSettings={openSettings}
      />
      {portalEl}
    </>
  )
}
