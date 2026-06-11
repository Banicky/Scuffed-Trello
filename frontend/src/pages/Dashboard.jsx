import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../api.js'
import { COLUMN_PALETTE } from '../constants.js'

function ChangePasswordModal({ onClose }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (form.newPassword !== form.confirmPassword) return setError('New passwords do not match')
    if (form.newPassword.length < 6) return setError('New password must be at least 6 characters')
    setLoading(true)
    const res = await apiFetch('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) return setError(data.error)
    setSuccess(true)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Change Password</span>
          <button className="members-panel-close" onClick={onClose}>✕</button>
        </div>
        {success ? (
          <div className="modal-success">
            <p>Password changed successfully.</p>
            <button className="btn-primary" onClick={onClose}>Done</button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="auth-label">Current password</label>
            <input
              className="card-input"
              type="password"
              value={form.currentPassword}
              onChange={e => setForm(f => ({ ...f, currentPassword: e.target.value }))}
              maxLength={255}
              autoFocus
              required
            />
            <label className="auth-label">New password</label>
            <input
              className="card-input"
              type="password"
              value={form.newPassword}
              onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))}
              maxLength={255}
              required
            />
            <label className="auth-label">Confirm new password</label>
            <input
              className="card-input"
              type="password"
              value={form.confirmPassword}
              onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
              maxLength={255}
              required
            />
            {error && <p className="auth-error">{error}</p>}
            <div className="modal-actions">
              <button className="btn-primary" type="submit" disabled={loading}>
                {loading ? 'Saving…' : 'Change password'}
              </button>
              <button className="btn-ghost" type="button" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function BoardSettingsPopover({ board, onRename, onDelete, onClose }) {
  const [renameVal, setRenameVal] = useState(board.title)
  const [confirming, setConfirming] = useState(false)
  const ref = useRef(null)

  // close when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  function handleRename(e) {
    e.preventDefault()
    if (!renameVal.trim() || renameVal.trim() === board.title) return onClose()
    onRename(board.id, renameVal.trim())
    onClose()
  }

  return (
    <div className="board-popover" ref={ref} onClick={e => e.stopPropagation()}>
      <p className="board-popover-label">Rename board</p>
      <form className="board-popover-rename" onSubmit={handleRename}>
        <input
          className="card-input"
          value={renameVal}
          onChange={e => setRenameVal(e.target.value)}
          maxLength={255}
          autoFocus
        />
        <button className="btn-primary" type="submit">Save</button>
      </form>
      <div className="board-popover-divider" />
      {confirming ? (
        <div className="board-popover-confirm">
          <span className="board-popover-confirm-msg">Delete this board?</span>
          <div className="board-popover-confirm-actions">
            <button className="btn-danger-sm" onClick={() => { onDelete(board.id); onClose() }}>Delete</button>
            <button className="btn-ghost-sm" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="board-popover-delete" onClick={() => setConfirming(true)}>
          Delete board
        </button>
      )}
    </div>
  )
}

function BoardCard({ board, index, onOpen, onDelete, onRename, isOwner }) {
  const [showSettings, setShowSettings] = useState(false)
  const color = COLUMN_PALETTE[index % COLUMN_PALETTE.length]

  return (
    <div className="board-card" onClick={() => !showSettings && onOpen(board.id)}>
      <div className="board-card-stripe" style={{ background: color }} />
      <div className="board-card-body">
        <span className="board-card-title">{board.title}</span>
        {isOwner && (
          <div className="board-card-actions" onClick={e => e.stopPropagation()}>
            <button
              className={`board-card-btn${showSettings ? ' active' : ''}`}
              title="Board settings"
              onClick={() => setShowSettings(v => !v)}
            >
              ⚙
            </button>
          </div>
        )}
      </div>
      {showSettings && (
        <BoardSettingsPopover
          board={board}
          onRename={onRename}
          onDelete={onDelete}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}

export default function Dashboard({ user, onOpenBoard, onLogout }) {
  const [boards, setBoards] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('mine')
  const [newTitle, setNewTitle] = useState('')
  const [addingBoard, setAddingBoard] = useState(false)
  const [showChangePw, setShowChangePw] = useState(false)

  useEffect(() => {
    apiFetch('/api/boards')
      .then(r => r.json())
      .then(data => { setBoards(data); setLoading(false) })
  }, [])

  async function createBoard(e) {
    e.preventDefault()
    if (!newTitle.trim()) return
    const res = await apiFetch('/api/boards', {
      method: 'POST',
      body: JSON.stringify({ title: newTitle.trim() }),
    })
    const board = await res.json()
    setBoards(b => [...b, board])
    setNewTitle('')
    setAddingBoard(false)
  }

  async function deleteBoard(boardId) {
    await apiFetch(`/api/boards/${boardId}`, { method: 'DELETE' })
    setBoards(b => b.filter(board => board.id !== boardId))
  }

  async function renameBoard(boardId, newTitle) {
    const res = await apiFetch(`/api/boards/${boardId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: newTitle }),
    })
    const updated = await res.json()
    setBoards(b => b.map(board => board.id === boardId ? { ...board, title: updated.title } : board))
  }

  const ownedBoards = boards.filter(b => b.role === 'owner')
  const sharedBoards = boards.filter(b => b.role === 'member')

  return (
    <div className="dashboard-shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="board-icon">S</div>
          <span className="board-name" style={{ cursor: 'default' }}>Scuffed Trello</span>
        </div>
        <div className="topbar-right">
          <span className="dashboard-username">{user.username}</span>
          <button className="btn-ghost" onClick={() => setShowChangePw(true)}>Change password</button>
          <button className="btn-ghost logout-btn" onClick={onLogout}>Log out</button>
        </div>
      </header>

      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}

      <main className="dashboard-main">
        <div className="dash-tabs">
          <button
            className={`dash-tab${activeTab === 'mine' ? ' active' : ''}`}
            onClick={() => setActiveTab('mine')}
          >
            My Boards
          </button>
          <button
            className={`dash-tab${activeTab === 'shared' ? ' active' : ''}`}
            onClick={() => setActiveTab('shared')}
          >
            Shared with me
            {sharedBoards.length > 0 && (
              <span className="dash-tab-count">{sharedBoards.length}</span>
            )}
          </button>
        </div>

        {activeTab === 'mine' && (
          <section className="dashboard-section">
            <div className="section-heading-row">
              {!addingBoard && (
                <button className="btn-ghost add-board-btn" onClick={() => setAddingBoard(true)}>+ New board</button>
              )}
            </div>

            {addingBoard && (
              <form className="new-board-form" onSubmit={createBoard}>
                <input
                  className="card-input"
                  placeholder="Board name"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  maxLength={255}
                  autoFocus
                />
                <button className="btn-primary" type="submit">Create</button>
                <button className="btn-ghost" type="button" onClick={() => { setAddingBoard(false); setNewTitle('') }}>Cancel</button>
              </form>
            )}

            {loading ? (
              <p className="dashboard-empty">Loading…</p>
            ) : ownedBoards.length === 0 ? (
              <p className="dashboard-empty">No boards yet. Create one above.</p>
            ) : (
              <div className="board-grid">
                {ownedBoards.map((b, i) => (
                  <BoardCard
                    key={b.id}
                    board={b}
                    index={i}
                    onOpen={onOpenBoard}
                    onDelete={deleteBoard}
                    onRename={renameBoard}
                    isOwner={true}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === 'shared' && (
          <section className="dashboard-section">
            {loading ? (
              <p className="dashboard-empty">Loading…</p>
            ) : sharedBoards.length === 0 ? (
              <p className="dashboard-empty">No boards have been shared with you yet.</p>
            ) : (
              <div className="board-grid">
                {sharedBoards.map((b, i) => (
                  <BoardCard
                    key={b.id}
                    board={b}
                    index={ownedBoards.length + i}
                    onOpen={onOpenBoard}
                    onDelete={deleteBoard}
                    onRename={renameBoard}
                    isOwner={false}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
