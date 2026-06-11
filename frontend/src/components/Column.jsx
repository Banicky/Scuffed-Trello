import { useState } from 'react'
import Card from './Card.jsx'
import { TAG_COLORS, COLUMN_PALETTE } from '../constants.js'

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
        maxLength={255}
        autoFocus
      />
      <input
        className="card-input"
        placeholder="Description (optional)"
        value={desc}
        onChange={e => setDesc(e.target.value)}
        maxLength={3000}
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
export default function Column({ column, colorIndex, onAddCard, onDeleteCard, onToggleStar, onEdit, onRenameColumn, onDeleteColumn, onDragOver, onDrop, isDragOver, onDragOverCard, dragOverCardId }) {
  const [adding, setAdding] = useState(false)
  const [editingTitle, setEditingTitle] = useState(!!column.editingTitle)
  const [confirming, setConfirming] = useState(false)

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
        {confirming ? (
          <div className="column-confirm">
            <span className="column-confirm-msg">Delete column?</span>
            <button className="btn-danger-sm" onClick={() => onDeleteColumn(column.id)}>Delete</button>
            <button className="btn-ghost-sm" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        ) : (
          <>
            <span className="column-dot" style={{ background: COLUMN_PALETTE[colorIndex % COLUMN_PALETTE.length] }} />
            {editingTitle ? (
              <input
                className="column-title-input"
                defaultValue={column.title}
                maxLength={255}
                autoFocus
                onBlur={e => { onRenameColumn(column.id, e.target.value); setEditingTitle(false) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { onRenameColumn(column.id, e.target.value); setEditingTitle(false) }
                  if (e.key === 'Escape') setEditingTitle(false)
                }}
              />
            ) : (
              <h2 className="column-title" onClick={() => setEditingTitle(true)} title="Click to rename">
                {column.title}
              </h2>
            )}
            <span className="column-count">{column.cards.length}</span>
            <button className="column-delete" onClick={() => setConfirming(true)} title="Delete column">✕</button>
          </>
        )}
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
