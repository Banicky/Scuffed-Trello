import { useState } from 'react'
import Tag from './Tag.jsx'
import { TAG_COLORS } from '../constants.js'

function EditCardForm({ card, onSave, onCancel }) {
  const [title, setTitle] = useState(card.title)
  const [desc, setDesc] = useState(card.description || '')
  const [tag, setTag] = useState(card.label_name || 'Design')

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    onSave({ title: title.trim(), description: desc.trim(), label_name: tag, label_color: TAG_COLORS[tag]?.color })
  }

  return (
    <form className="add-card-form" onSubmit={handleSubmit}>
      <select className="card-input" value={tag} onChange={e => setTag(e.target.value)}>
        {Object.keys(TAG_COLORS).map(t => <option key={t}>{t}</option>)}
      </select>
      <input
        className="card-input"
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
        <button className="btn-primary" type="submit">Save</button>
        <button className="btn-ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

// onDragStart: stores this card's id in the drag event so the drop target knows which card was picked up
// onDragOverCard: tells App which card is currently being hovered over, used to determine insertion point
// isDropTarget: when true, renders a purple top border showing where the dragged card will be inserted
export default function Card({ card, onDelete, onToggleStar, onEdit, onDragStart, onDragOverCard, isDropTarget }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <div className="kanban-card">
        <EditCardForm
          card={card}
          onSave={data => { onEdit(card.id, data); setEditing(false) }}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }

  return (
    <div
      className={`kanban-card${isDropTarget ? ' drop-target' : ''}${card.starred ? ' starred' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={e => { e.preventDefault(); onDragOverCard(card.id) }}
    >
      <div className="card-header">
        <Tag label={card.label_name} color={card.label_color} />
        <div className="card-actions">
          <button
            className={`card-star${card.starred ? ' active' : ''}`}
            onClick={() => onToggleStar(card.id, card.starred)}
            title={card.starred ? 'Unstar' : 'Star'}
          >
            {card.starred ? '★' : '☆'}
          </button>
          <button className="card-delete" onClick={() => onDelete(card.id)} title="Remove card">
            ✕
          </button>
        </div>
      </div>
      <p className="card-title">{card.title}</p>
      {card.description && <p className="card-desc">{card.description}</p>}
      <div className="card-footer">
        <button className="card-edit" onClick={() => setEditing(true)} title="Edit card">✎</button>
      </div>
    </div>
  )
}
