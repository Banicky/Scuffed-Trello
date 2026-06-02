import { useState, useEffect } from 'react' // triggers api call when page first loads
import './App.css'

const API = 'http://localhost:4000'

// predefined tag colors
const TAG_COLORS = {
  Design:   { bg: 'rgba(236, 72, 153, 0.12)', color: '#ec4899' },
  DevOps:   { bg: 'rgba(59, 130, 246, 0.12)', color: '#3b82f6' },
  Docs:     { bg: 'rgba(107, 114, 128, 0.12)', color: '#6b7280' },
  Backend:  { bg: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b' },
  Frontend: { bg: 'rgba(139, 92, 246, 0.12)', color: '#8b5cf6' },
  Planning: { bg: 'rgba(16, 185, 129, 0.12)', color: '#10b981' },
}

// dot next to the title in each column
const COLUMN_COLORS = {
  'TO DO':       '#6b7280',
  'IN PROGRESS': '#f59e0b',
  'IN REVIEW':   '#8b5cf6',
  'DONE':        '#10b981',
}

function Tag({ label, color }) {
  const style = TAG_COLORS[label] || { bg: 'rgba(99,102,241,0.12)', color: color || '#6366f1' }
  return (
    <span className="card-tag" style={{ background: style.bg, color: style.color }}>
      {label}
    </span>
  )
}

// onDragStart: stores this card's id in the drag event so the drop target knows which card was picked up
// onDragOverCard: tells App which card is currently being hovered over, used to determine insertion point
// isDropTarget: when true, renders a purple top border showing where the dragged card will be inserted
function Card({ card, onDelete, onDragStart, onDragOverCard, isDropTarget }) {
  return (
    <div
      className={`kanban-card${isDropTarget ? ' drop-target' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={e => { e.preventDefault(); onDragOverCard(card.id) }}
    >
      <div className="card-header">
        <Tag label={card.label_name} color={card.label_color} />
        <button className="card-delete" onClick={() => onDelete(card.id)} title="Remove card">
          ✕
        </button>
      </div>
      <p className="card-title">{card.title}</p>
      {card.description && <p className="card-desc">{card.description}</p>}
    </div>
  )
}

// uses label_name and label_color from the joined query to create tag, if no label, pass null to avoid showing default tag
function AddCardForm({ onAdd, onCancel }) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [tag, setTag] = useState('Design')

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    onAdd({ title: title.trim(), description: desc.trim(), label_name: tag, label_color: TAG_COLORS[tag]?.color })
    setTitle('')
    setDesc('')
  }

  return (
    <form className="add-card-form" onSubmit={handleSubmit}>
      <select className="card-input" value={tag} onChange={e => setTag(e.target.value)}>
        {Object.keys(TAG_COLORS).map(t => <option key={t}>{t}</option>)}
      </select>
      <input
        className="card-input"
        placeholder="Card title"
        value={title}
        onChange={e => setTitle(e.target.value)}
        autoFocus
      />
      <input
        className="card-input"
        placeholder="Description (optional)"
        value={desc}
        onChange={e => setDesc(e.target.value)}
      />
      <div className="add-card-actions">
        <button className="btn-primary" type="submit">Add card</button>
        <button className="btn-ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

// onDragOver: tells App which column is being hovered so it can apply the drag-over highlight
// onDragLeave: clears the highlight when the drag leaves this column
// onDrop: when a card is dropped, passes the event
// isDragOver: when true, applies the purple border/background highlight to the column
// onDragOverCard / dragOverCardId: passed through to each Card so the insertion indicator works
function Column({ column, onAddCard, onDeleteCard, onDragOver, onDrop, isDragOver, onDragOverCard, dragOverCardId }) {
  const [adding, setAdding] = useState(false)

  async function handleAdd(cardData) {
    await onAddCard(column.id, cardData, column.cards.length + 1)
    setAdding(false)
  }

  return (
    <div
      className={`kanban-column${isDragOver ? ' drag-over' : ''}`}
      onDragOver={e => { e.preventDefault(); onDragOver(column.id) }}
      onDragLeave={() => onDragOver(null)}
      onDrop={e => onDrop(e, column.id)}
    >
      <div className="column-header">
        <span className="column-dot" style={{ background: COLUMN_COLORS[column.title] || '#6b7280' }} />
        <h2 className="column-title">{column.title}</h2>
        <span className="column-count">{column.cards.length}</span>
      </div>
      <div className="column-cards">
        {column.cards.map(card => (
          <Card
            key={card.id}
            card={card}
            onDelete={id => onDeleteCard(column.id, id)}
            // store cardId in dataTransfer so moveCard can read it on drop
            onDragStart={e => e.dataTransfer.setData('cardId', card.id)}
            onDragOverCard={onDragOverCard}
            isDropTarget={dragOverCardId === card.id}
          />
        ))}
        {adding
          ? <AddCardForm onAdd={handleAdd} onCancel={() => setAdding(false)} />
          : (
            <button className="add-card-btn" onClick={() => setAdding(true)}>
              <span className="add-card-plus">+</span> Add a card
            </button>
          )
        }
      </div>
    </div>
  )
}

export default function App() {
  const [columns, setColumns] = useState([])
  const [loading, setLoading] = useState(true)
  // tracks which column the dragged card is currently hovering over (for highlight)
  const [dragOverColId, setDragOverColId] = useState(null)
  // tracks which card the dragged card is hovering over (for insertion point indicator)
  const [dragOverCardId, setDragOverCardId] = useState(null)

  // on page load: fetch columns for board 1, then fetch cards for each column in parallel
  useEffect(() => {
    async function load() {
      const colRes = await fetch(`${API}/api/boards/1/columns`)
      const cols = await colRes.json()

      const withCards = await Promise.all(cols.map(async col => {
        const cardRes = await fetch(`${API}/api/columns/${col.id}/cards`)
        const cards = await cardRes.json()
        return { ...col, cards }
      }))

      setColumns(withCards)
      setLoading(false)
    }
    load()
  }, [])

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

    let updatedSourceCards, updatedTargetCards

    if (sameColumn) {
      // reorder within the same column: remove the card then splice it in at the hovered position
      const cards = sourceCol.cards.filter(c => c.id !== cardId)
      const insertAt = overCardId ? cards.findIndex(c => c.id === overCardId) : cards.length
      cards.splice(insertAt >= 0 ? insertAt : cards.length, 0, card)
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
      const insertAt = overCardId ? targetCards.findIndex(c => c.id === overCardId) : targetCards.length
      targetCards.splice(insertAt >= 0 ? insertAt : targetCards.length, 0, card)
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

  // show loading screen while initial fetch is in progress
  if (loading) return <div className="app-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}>Loading...</div>

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="board-icon">K</div>
          <div>
            <div className="board-name">My Project</div>
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
            onDragOver={setDragOverColId}
            onDrop={moveCard}
            isDragOver={dragOverColId === col.id}
            onDragOverCard={setDragOverCardId}
            dragOverCardId={dragOverCardId}
          />
        ))}
      </main>
    </div>
  )
}
