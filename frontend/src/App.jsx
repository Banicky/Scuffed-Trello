import { useState, useEffect } from 'react'
import './App.css'
import { apiFetch } from './api.js'
import AuthPage from './pages/AuthPage.jsx'
import Dashboard from './pages/Dashboard.jsx'
import BoardView from './pages/BoardView.jsx'

// Derive the current route from the URL hash so it survives a page refresh.
// #/board/<id> → a board, anything else → the dashboard.
function parseHash() {
  const match = window.location.hash.match(/^#\/board\/(\d+)/)
  if (match) return { view: 'board', boardId: Number(match[1]) }
  return { view: 'dashboard', boardId: null }
}

export default function App() {
  const [status, setStatus] = useState('loading') // loading | auth | ready
  const [user, setUser] = useState(null)
  const [route, setRoute] = useState(parseHash)

  useEffect(() => {
    apiFetch('/api/auth/me').then(res => {
      if (res.ok) return res.json().then(u => { setUser(u); setStatus('ready') })
      setStatus('auth')
    })
  }, [])

  // Keep the route in sync with browser navigation (refresh, back/forward).
  useEffect(() => {
    function onHashChange() { setRoute(parseHash()) }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function handleLogin(u) {
    setUser(u)
    setStatus('ready')
  }

  async function handleLogout() {
    await apiFetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    window.location.hash = '#/'
    setStatus('auth')
  }

  function openBoard(boardId) {
    window.location.hash = `#/board/${boardId}`
  }

  function goDashboard() {
    window.location.hash = '#/'
  }

  if (status === 'loading') {
    return (
      <div className="app-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}>
        Loading…
      </div>
    )
  }

  if (status === 'auth') return <AuthPage onLogin={handleLogin} />

  if (route.view === 'board') return (
    <BoardView
      boardId={route.boardId}
      user={user}
      onBack={goDashboard}
    />
  )

  return (
    <Dashboard
      user={user}
      onOpenBoard={openBoard}
      onLogout={handleLogout}
    />
  )
}
