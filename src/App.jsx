import { useState } from 'react'
import './App.css'

const INITIAL_COLUMNS = [
  {
    id: 'todo',
    title: 'To Do',
    color: '#6b7280',
    cards: [
      { id: 'c1', title: 'Design landing page', desc: 'Wireframes and mockups', tag: 'Design' },
      { id: 'c2', title: 'Set up CI/CD pipeline', desc: 'GitHub Actions config', tag: 'DevOps' },
      { id: 'c3', title: 'Write API docs', desc: 'OpenAPI spec for endpoints', tag: 'Docs' },
    ],
  },
  {
    id: 'in-progress',
    title: 'In Progress',
    color: '#f59e0b',
    cards: [
      { id: 'c4', title: 'Build auth system', desc: 'JWT + refresh tokens', tag: 'Backend' },
      { id: 'c5', title: 'Dashboard UI', desc: 'React components for main view', tag: 'Frontend' },
    ],
  },
  {
    id: 'review',
    title: 'In Review',
    color: '#8b5cf6',
    cards: [
      { id: 'c6', title: 'Database schema', desc: 'PostgreSQL migrations ready', tag: 'Backend' },
    ],
  },
  {
    id: 'done',
    title: 'Done',
    color: '#10b981',
    cards: [
      { id: 'c7', title: 'Project setup', desc: 'Vite + React boilerplate', tag: 'DevOps' },
      { id: 'c8', title: 'Define requirements', desc: 'Product spec approved', tag: 'Planning' },
    ],
  },
]

const TAG_COLORS = {
  Design:   { bg: 'rgba(236, 72, 153, 0.12)', color: '#ec4899' },
  DevOps:   { bg: 'rgba(59, 130, 246, 0.12)', color: '#3b82f6' },
  Docs:     { bg: 'rgba(107, 114, 128, 0.12)', color: '#6b7280' },
  Backend:  { bg: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b' },
  Frontend: { bg: 'rgba(139, 92, 246, 0.12)', color: '#8b5cf6' },
  Planning: { bg: 'rgba(16, 185, 129, 0.12)', color: '#10b981' },
}

function Tag({ label }) {
  const style = TAG_COLORS[label] || { bg: 'var(--accent-bg)', color: 'var(--accent)' }
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
        <Tag label={card.tag} />
        <button className="card-delete" onClick={() => onDelete(card.id)} title="Remove card">
          ✕
        </button>
      </div>
      <p className="card-title">{card.title}</p>
      {card.desc && <p className="card-desc">{card.desc}</p>}
    </div>
  )
}

function AddCardForm({ onAdd, onCancel }) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [tag, setTag] = useState('Design')

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    onAdd({ title: title.trim(), desc: desc.trim(), tag })
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

  function handleAdd(cardData) {
    onAddCard(column.id, cardData)
    setAdding(false)
  }

  return (
    <div className="kanban-column">
      <div className="column-header">
        <span className="column-dot" style={{ background: column.color }} />
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

let nextId = 100

export default function App() {
  const [columns, setColumns] = useState(INITIAL_COLUMNS)

  function addCard(columnId, cardData) {
    setColumns(cols => cols.map(col =>
      col.id === columnId
        ? { ...col, cards: [...col.cards, { ...cardData, id: `c${++nextId}` }] }
        : col
    ))
  }

  function deleteCard(columnId, cardId) {
    setColumns(cols => cols.map(col =>
      col.id === columnId
        ? { ...col, cards: col.cards.filter(c => c.id !== cardId) }
        : col
    ))
  }

  const totalCards = columns.reduce((sum, col) => sum + col.cards.length, 0)
  const doneCount = columns.find(c => c.id === 'done')?.cards.length ?? 0

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
