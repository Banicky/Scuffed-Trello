import { useState, useEffect } from 'react'
import './App.css'
import { apiFetch } from './api.js'
import AuthPage from './pages/AuthPage.jsx'
import Dashboard from './pages/Dashboard.jsx'
import BoardView from './pages/BoardView.jsx'

export default function App() {
  const [view, setView] = useState('loading')
  const [user, setUser] = useState(null)
  const [activeBoardId, setActiveBoardId] = useState(null)

  useEffect(() => {
    apiFetch('/api/auth/me').then(res => {
      if (res.ok) return res.json().then(u => { setUser(u); setView('dashboard') })
      setView('auth')
    })
  }, [])

  function handleLogin(u) {
    setUser(u)
    setView('dashboard')
  }

  async function handleLogout() {
    await apiFetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    setActiveBoardId(null)
    setView('auth')
  }

  function openBoard(boardId) {
    setActiveBoardId(boardId)
    setView('board')
  }

  if (view === 'loading') {
    return (
      <div className="app-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}>
        Loading…
      </div>
    )
  }

  if (view === 'auth') return <AuthPage onLogin={handleLogin} />

  if (view === 'board') return (
    <BoardView
      boardId={activeBoardId}
      user={user}
      onBack={() => setView('dashboard')}
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
