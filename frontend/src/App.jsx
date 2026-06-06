import { useState, useEffect } from 'react'
import './App.css'
import Column from './components/Column.jsx'

const API = 'http://localhost:4000'

export default function App() {
  const [columns, setColumns] = useState([])
  const [loading, setLoading] = useState(true)
  const [board, setBoard] = useState(null)
  const [editingTitle, setEditingTitle] = useState(false)
  // tracks which column the dragged card is currently hovering over (for highlight)
  const [dragOverColId, setDragOverColId] = useState(null)
  // tracks which card the dragged card is hovering over (for insertion point indicator)
  const [dragOverCardId, setDragOverCardId] = useState(null)

  // on page load: fetch columns for board 1, then fetch cards for each column in parallel
  useEffect(() => {
    async function load() {
      const colRes = await fetch(`${API}/api/boards/1/columns`)
      const cols = await colRes.json()
      const boardRes = await fetch(`${API}/api/boards/1`)
      const boardData = await boardRes.json()
      setBoard(boardData)

      const withCards = await Promise.all(cols.map(async col => {
        const cardRes = await fetch(`${API}/api/columns/${col.id}/cards`)
        const cards = await cardRes.json()
        // keep starred cards pinned to the top of each column
        const sorted = [...cards].sort((a, b) => b.starred - a.starred)
        return { ...col, cards: sorted }
      }))

      setColumns(withCards)
      setLoading(false)
    }
    load()
  }, [])

  async function renameBoard(newTitle) {
    if (!newTitle.trim() || newTitle === board.title) return
    const res = await fetch(`${API}/api/boards/${board.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim() }),
    })
    const updated = await res.json()
    setBoard(updated)
  }

  // POSTs new card to API, then adds the returned card (with label) to state immediately
  async function addCard(columnId, cardData, position) {
    const res = await fetch(`${API}/api/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column_id: columnId, position, ...cardData }),
    })
    const newCard = await res.json()
    setColumns(cols => cols.map(col =>
      col.id === columnId ? { ...col, cards: [...col.cards, newCard] } : col
    ))
  }

  async function editCard(columnId, cardId, cardData) {
    const res = await fetch(`${API}/api/cards/${cardId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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

    await fetch(`${API}/api/cards/${cardId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ starred: newStarred }),
    })

    // Re-sort the column so starred cards are always at the top of the state array,
    // then repatch all positions so DB order matches what's on screen after refresh
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
      fetch(`${API}/api/cards/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column_id: columnId, position: i }),
      })
    ))
  }

  async function addColumn() {
    const position = columns.length
    const res = await fetch(`${API}/api/columns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board_id: board.id, title: 'New Column', position }),
    })
    const newCol = await res.json()
    setColumns(cols => [...cols, { ...newCol, cards: [], editingTitle: true }])
  }

  async function renameColumn(columnId, newTitle) {
    if (!newTitle.trim()) return
    const res = await fetch(`${API}/api/columns/${columnId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim() }),
    })
    const updated = await res.json()
    setColumns(cols => cols.map(col =>
      col.id === columnId ? { ...col, title: updated.title } : col
    ))
  }

  async function deleteColumn(columnId) {
    await fetch(`${API}/api/columns/${columnId}`, { method: 'DELETE' })
    setColumns(cols => cols.filter(col => col.id !== columnId))
  }

  async function deleteCard(columnId, cardId) {
    await fetch(`${API}/api/cards/${cardId}`, { method: 'DELETE' })
    setColumns(cols => cols.map(col =>
      col.id === columnId ? { ...col, cards: col.cards.filter(c => c.id !== cardId) } : col
    ))
  }

  async function moveCard(e, targetColumnId) {
    const cardId = Number(e.dataTransfer.getData('cardId'))
    // snapshot overCardId before clearing — state updates are async
    const overCardId = dragOverCardId
    setDragOverColId(null)
    setDragOverCardId(null)

    const sourceCol = columns.find(col => col.cards.some(c => c.id === cardId))
    if (!sourceCol) return

    const card = sourceCol.cards.find(c => c.id === cardId)
    const sameColumn = sourceCol.id === targetColumnId

    // Clamp the insertion index so starred cards never end up below unstarred ones
    // and unstarred cards never end up above starred ones
    function clampInsert(dragged, pool, rawAt) {
      const starredCount = pool.filter(c => c.starred).length
      return dragged.starred ? Math.min(rawAt, starredCount) : Math.max(rawAt, starredCount)
    }

    let updatedSourceCards, updatedTargetCards

    if (sameColumn) {
      // reorder within the same column: remove the card then splice it in at the hovered position
      const cards = sourceCol.cards.filter(c => c.id !== cardId)
      const rawAt = overCardId ? cards.findIndex(c => c.id === overCardId) : cards.length
      const insertAt = clampInsert(card, cards, rawAt >= 0 ? rawAt : cards.length)
      cards.splice(insertAt, 0, card)
      updatedSourceCards = cards
      updatedTargetCards = cards

      // bail out if the order didn't actually change
      if (cards.map(c => c.id).join() === sourceCol.cards.map(c => c.id).join()) return

      setColumns(cols => cols.map(col =>
        col.id === targetColumnId ? { ...col, cards } : col
      ))
    } else {
      // cross-column move: remove from source, insert into target at the hovered position
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

    // patch every card in the affected column(s) with its new position index so order persists on refresh
    const toPatch = sameColumn
      ? updatedTargetCards.map((c, i) => ({ id: c.id, column_id: targetColumnId, position: i }))
      : [
          ...updatedSourceCards.map((c, i) => ({ id: c.id, column_id: sourceCol.id, position: i })),
          ...updatedTargetCards.map((c, i) => ({ id: c.id, column_id: targetColumnId, position: i })),
        ]

    await Promise.all(toPatch.map(({ id, column_id, position }) =>
      fetch(`${API}/api/cards/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column_id, position }),
      })
    ))
  }

  // totalCards and doneCount drive the "X cards · X done" in the header
  const totalCards = columns.reduce((sum, col) => sum + col.cards.length, 0)
  const doneCount = columns.find(c => c.title === 'DONE')?.cards.length ?? 0

  if (loading) return <div className="app-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}>Loading...</div>

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
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
            <div className="board-meta">{totalCards} cards &middot; {doneCount} done</div>
          </div>
        </div>
        <div className="topbar-right">
          <div className="avatar" title="Guest">G</div>
        </div>
      </header>

      <main className="board">
        {columns.map(col => (
          <Column
            key={col.id}
            column={col}
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
