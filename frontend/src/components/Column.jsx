import { useState } from 'react'
import Card from './Card.jsx'
import { TAG_COLORS, COLUMN_COLORS } from '../constants.js'

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
export default function Column({ column, onAddCard, onDeleteCard, onToggleStar, onEdit, onDragOver, onDrop, isDragOver, onDragOverCard, dragOverCardId }) {
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
            onToggleStar={onToggleStar}
            onEdit={(cardId, data) => onEdit(column.id, cardId, data)}
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
