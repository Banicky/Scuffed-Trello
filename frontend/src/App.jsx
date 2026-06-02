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

function Card({ card, onDelete }) {
  return (
    <div className="kanban-card">
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

function Column({ column, onAddCard, onDeleteCard }) {
  const [adding, setAdding] = useState(false)

  async function handleAdd(cardData) {
    await onAddCard(column.id, cardData, column.cards.length + 1)
    setAdding(false)
  }

  return (
    <div className="kanban-column">
      <div className="column-header">
        <span className="column-dot" style={{ background: COLUMN_COLORS[column.title] || '#6b7280' }} />
        <h2 className="column-title">{column.title}</h2>
        <span className="column-count">{column.cards.length}</span>
      </div>
      <div className="column-cards">
        {column.cards.map(card => (
          <Card key={card.id} card={card} onDelete={id => onDeleteCard(column.id, id)} />
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
  // starts empty, fills in after API fetch completes
  const [columns, setColumns] = useState([])
  const [loading, setLoading] = useState(true)

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

  // sends DELETE to API, then removes card from state
  async function deleteCard(columnId, cardId) {
    await fetch(`${API}/api/cards/${cardId}`, { method: 'DELETE' })
    setColumns(cols => cols.map(col =>
      col.id === columnId ? { ...col, cards: col.cards.filter(c => c.id !== cardId) } : col
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
          />
        ))}
      </main>
    </div>
  )
}