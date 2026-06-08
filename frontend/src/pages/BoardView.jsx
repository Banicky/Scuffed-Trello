import { useState, useEffect } from 'react'
import Column from '../components/Column.jsx'
import { apiFetch } from '../api.js'
import { COLUMN_PALETTE } from '../constants.js'

function MembersPanel({ boardId, isOwner, onClose }) {
  const [members, setMembers] = useState([])
  const [invite, setInvite] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch(`/api/boards/${boardId}/members`)
      .then(r => r.json())
      .then(setMembers)
  }, [boardId])

  async function handleInvite(e) {
    e.preventDefault()
    setError('')
    const res = await apiFetch(`/api/boards/${boardId}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: invite.trim() }),
    })
    const data = await res.json()
    if (!res.ok) return setError(data.error)
    setMembers(m => [...m, data])
    setInvite('')
  }

  async function handleRemove(userId) {
    await apiFetch(`/api/boards/${boardId}/members/${userId}`, { method: 'DELETE' })
    setMembers(m => m.filter(u => u.id !== userId))
  }

  return (
    <div className="members-panel board-members-panel">
      <div className="members-panel-header">
        <span className="members-panel-title">Members</span>
        <button className="members-panel-close" onClick={onClose}>✕</button>
      </div>
      <ul className="members-list">
        {members.map(u => (
          <li key={u.id} className="member-row">
            <div className="avatar member-avatar" title={u.username}>{u.username.charAt(0).toUpperCase()}</div>
            <span className="member-name">{u.username}</span>
            {isOwner && (
              <button className="member-remove" onClick={() => handleRemove(u.id)} title="Remove">✕</button>
            )}
          </li>
        ))}
        {members.length === 0 && <li className="members-empty">No members yet.</li>}
      </ul>
      {isOwner && (
        <form className="invite-form" onSubmit={handleInvite}>
          <input
            className="card-input"
            placeholder="Username or email"
            value={invite}
            onChange={e => setInvite(e.target.value)}
          />
          <button className="btn-primary" type="submit">Invite</button>
        </form>
      )}
      {error && <p className="auth-error" style={{ marginTop: 6 }}>{error}</p>}
    </div>
  )
}

export default function BoardView({ boardId, user, onBack }) {
  const [columns, setColumns] = useState([])
  const [loading, setLoading] = useState(true)
  const [board, setBoard] = useState(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [dragOverColId, setDragOverColId] = useState(null)
  const [dragOverCardId, setDragOverCardId] = useState(null)
  const [showMembers, setShowMembers] = useState(false)

  const isOwner = board?.owner_id === user.id

  useEffect(() => {
    async function load() {
      const [colRes, boardRes] = await Promise.all([
        apiFetch(`/api/boards/${boardId}/columns`),
        apiFetch(`/api/boards/${boardId}`),
      ])
      const cols = await colRes.json()
      const boardData = await boardRes.json()
      setBoard(boardData)

      const withCards = await Promise.all(cols.map(async col => {
        const cardRes = await apiFetch(`/api/columns/${col.id}/cards`)
        const cards = await cardRes.json()
        const sorted = [...cards].sort((a, b) => b.starred - a.starred)
        return { ...col, cards: sorted }
      }))

      setColumns(withCards)
      setLoading(false)
    }
    load()
  }, [boardId])

  async function renameBoard(newTitle) {
    if (!newTitle.trim() || newTitle === board.title) return
    const res = await apiFetch(`/api/boards/${board.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: newTitle.trim() }),
    })
    const updated = await res.json()
    setBoard(updated)
  }

  async function addCard(columnId, cardData, position) {
    const res = await apiFetch('/api/cards', {
      method: 'POST',
      body: JSON.stringify({ column_id: columnId, position, ...cardData }),
    })
    const newCard = await res.json()
    setColumns(cols => cols.map(col =>
      col.id === columnId ? { ...col, cards: [...col.cards, newCard] } : col
    ))
  }

  async function editCard(columnId, cardId, cardData) {
    const res = await apiFetch(`/api/cards/${cardId}`, {
      method: 'PATCH',
      body: JSON.stringify(cardData),
    })
    const updated = await res.json()
    setColumns(cols => cols.map(col =>
      col.id === columnId
        ? { ...col, cards: col.cards.map(c => c.id === cardId ? { ...c, ...updated } : c) }
        : col
    ))
  }

  async function toggleStar(columnId, cardId, currentStarred) {
    const newStarred = !currentStarred
    await apiFetch(`/api/cards/${cardId}`, {
      method: 'PATCH',
      body: JSON.stringify({ starred: newStarred }),
    })

    const col = columns.find(c => c.id === columnId)
    const updated = col.cards.map(c => c.id === cardId ? { ...c, starred: newStarred } : c)
    const reordered = [
      ...updated.filter(c => c.starred),
      ...updated.filter(c => !c.starred),
    ]

    setColumns(cols => cols.map(c =>
      c.id === columnId ? { ...c, cards: reordered } : c
    ))

    await Promise.all(reordered.map((c, i) =>
      apiFetch(`/api/cards/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ column_id: columnId, position: i }),
      })
    ))
  }

  async function addColumn() {
    const position = columns.length
    const res = await apiFetch('/api/columns', {
      method: 'POST',
      body: JSON.stringify({ board_id: board.id, title: 'New Column', position }),
    })
    const newCol = await res.json()
    setColumns(cols => [...cols, { ...newCol, cards: [], editingTitle: true }])
  }

  async function renameColumn(columnId, newTitle) {
    if (!newTitle.trim()) return
    const res = await apiFetch(`/api/columns/${columnId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: newTitle.trim() }),
    })
    const updated = await res.json()
    setColumns(cols => cols.map(col =>
      col.id === columnId ? { ...col, title: updated.title } : col
    ))
  }

  async function deleteColumn(columnId) {
    await apiFetch(`/api/columns/${columnId}`, { method: 'DELETE' })
    setColumns(cols => cols.filter(col => col.id !== columnId))
  }

  async function deleteCard(columnId, cardId) {
    await apiFetch(`/api/cards/${cardId}`, { method: 'DELETE' })
    setColumns(cols => cols.map(col =>
      col.id === columnId ? { ...col, cards: col.cards.filter(c => c.id !== cardId) } : col
    ))
  }

  async function moveCard(e, targetColumnId) {
    const cardId = Number(e.dataTransfer.getData('cardId'))
    const overCardId = dragOverCardId
    setDragOverColId(null)
    setDragOverCardId(null)

    const sourceCol = columns.find(col => col.cards.some(c => c.id === cardId))
    if (!sourceCol) return

    const card = sourceCol.cards.find(c => c.id === cardId)
    const sameColumn = sourceCol.id === targetColumnId

    function clampInsert(dragged, pool, rawAt) {
      const starredCount = pool.filter(c => c.starred).length
      return dragged.starred ? Math.min(rawAt, starredCount) : Math.max(rawAt, starredCount)
    }

    let updatedSourceCards, updatedTargetCards

    if (sameColumn) {
      const cards = sourceCol.cards.filter(c => c.id !== cardId)
      const rawAt = overCardId ? cards.findIndex(c => c.id === overCardId) : cards.length
      const insertAt = clampInsert(card, cards, rawAt >= 0 ? rawAt : cards.length)
      cards.splice(insertAt, 0, card)
      updatedSourceCards = cards
      updatedTargetCards = cards

      if (cards.map(c => c.id).join() === sourceCol.cards.map(c => c.id).join()) return

      setColumns(cols => cols.map(col =>
        col.id === targetColumnId ? { ...col, cards } : col
      ))
    } else {
      updatedSourceCards = sourceCol.cards.filter(c => c.id !== cardId)
      const targetCol = columns.find(col => col.id === targetColumnId)
      const targetCards = [...targetCol.cards]
      const rawAt = overCardId ? targetCards.findIndex(c => c.id === overCardId) : targetCards.length
      const insertAt = clampInsert(card, targetCards, rawAt >= 0 ? rawAt : targetCards.length)
      targetCards.splice(insertAt, 0, card)
      updatedTargetCards = targetCards

      setColumns(cols => cols.map(col => {
        if (col.id === sourceCol.id) return { ...col, cards: updatedSourceCards }
        if (col.id === targetColumnId) return { ...col, cards: updatedTargetCards }
        return col
      }))
    }

    const toPatch = sameColumn
      ? updatedTargetCards.map((c, i) => ({ id: c.id, column_id: targetColumnId, position: i }))
      : [
          ...updatedSourceCards.map((c, i) => ({ id: c.id, column_id: sourceCol.id, position: i })),
          ...updatedTargetCards.map((c, i) => ({ id: c.id, column_id: targetColumnId, position: i })),
        ]

    await Promise.all(toPatch.map(({ id, column_id, position }) =>
      apiFetch(`/api/cards/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ column_id, position }),
      })
    ))
  }

  const totalCards = columns.reduce((sum, col) => sum + col.cards.length, 0)
  const doneCol = columns.find(c => c.title.toUpperCase() === 'DONE')
  const doneCount = doneCol?.cards.length ?? 0

  if (loading) return (
    <div className="app-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}>
      Loading…
    </div>
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <button className="back-btn" onClick={onBack} title="Back to dashboard">←</button>
          <div className="board-icon">{board?.title?.charAt(0)}</div>
          <div>
            {editingTitle ? (
              <input
                className="board-name-input"
                defaultValue={board.title}
                autoFocus
                onBlur={e => { renameBoard(e.target.value); setEditingTitle(false) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { renameBoard(e.target.value); setEditingTitle(false) }
                  if (e.key === 'Escape') setEditingTitle(false)
                }}
              />
            ) : (
              <div className="board-name" onClick={() => setEditingTitle(true)} title="Click to rename">
                {board.title}
              </div>
            )}
            <div className="board-meta">{totalCards} cards · {doneCount} done</div>
          </div>
        </div>
        <div className="topbar-right">
          <button
            className={`btn-ghost members-toggle${showMembers ? ' active' : ''}`}
            onClick={() => setShowMembers(v => !v)}
          >
            👥 Members
          </button>
          <div className="avatar" title={user.username}>{user.username.charAt(0).toUpperCase()}</div>
        </div>
      </header>

      {showMembers && (
        <div className="board-members-overlay" onClick={() => setShowMembers(false)}>
          <div onClick={e => e.stopPropagation()}>
            <MembersPanel boardId={boardId} isOwner={isOwner} onClose={() => setShowMembers(false)} />
          </div>
        </div>
      )}

      <main className="board">
        {columns.map((col, i) => (
          <Column
            key={col.id}
            column={col}
            colorIndex={i}
            onAddCard={addCard}
            onDeleteCard={deleteCard}
            onToggleStar={(cardId, starred) => toggleStar(col.id, cardId, starred)}
            onEdit={editCard}
            onRenameColumn={renameColumn}
            onDeleteColumn={deleteColumn}
            onDragOver={setDragOverColId}
            onDrop={moveCard}
            isDragOver={dragOverColId === col.id}
            onDragOverCard={setDragOverCardId}
            dragOverCardId={dragOverCardId}
          />
        ))}
        <button className="add-column-btn" onClick={addColumn}>
          <span>+</span> Add column
        </button>
      </main>
    </div>
  )
}
