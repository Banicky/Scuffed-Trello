import { useState, useEffect, useRef } from 'react'
import Tag from './Tag.jsx'
import { TAG_COLORS } from '../constants.js'

const QUICK_EMOJIS = ['👍', '👎', '❤️', '😄', '🎉', '🚀', '😮', '😢']

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
      <textarea
        className="card-input card-desc-input"
        placeholder="Description (optional)"
        value={desc}
        onChange={e => setDesc(e.target.value)}
        rows={3}
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
export default function Card({ card, onDelete, onToggleStar, onEdit, onReact, currentUserId, onDragStart, onDragOverCard, isDropTarget, onOpenDetail }) {
  const [editing, setEditing] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const pickerRef = useRef(null)

  useEffect(() => {
    if (!showPicker) return
    function handleClick(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setShowPicker(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showPicker])

  const grouped = (card.reactions || []).reduce((acc, r) => {
    if (!acc[r.emoji]) acc[r.emoji] = { count: 0, userIds: [] }
    acc[r.emoji].count++
    acc[r.emoji].userIds.push(r.userId)
    return acc
  }, {})

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
      <p className="card-title card-title--clickable" onClick={onOpenDetail}>{card.title}</p>
      {card.description && <p className="card-desc card-desc--clickable" onClick={onOpenDetail}>{card.description}</p>}
      <div className="card-reactions" ref={pickerRef}>
        {Object.entries(grouped).map(([emoji, { count, userIds }]) => (
          <button
            key={emoji}
            draggable={false}
            className={`reaction-pill${userIds.includes(currentUserId) ? ' active' : ''}`}
            onClick={() => onReact(card.id, emoji)}
          >
            {emoji} <span>{count}</span>
          </button>
        ))}
        <button
          draggable={false}
          className="reaction-add-btn"
          onClick={() => setShowPicker(p => !p)}
          title="Add reaction"
        >+</button>
        {showPicker && (
          <div className="reaction-picker">
            {QUICK_EMOJIS.map(e => (
              <button
                key={e}
                draggable={false}
                className={`reaction-option${grouped[e]?.userIds.includes(currentUserId) ? ' active' : ''}`}
                onClick={() => { onReact(card.id, e); setShowPicker(false) }}
              >{e}</button>
            ))}
          </div>
        )}
      </div>
      <div className="card-footer">
        <button className="card-edit" onClick={() => setEditing(true)} title="Edit card">✎</button>
        <div className="card-by-info">
          {card.last_edited_by_username && (
            <>
              <span className="card-by card-last-edited">last edited by: {card.last_edited_by_username}</span>
              {card.updated_at && (
                <span className="card-by card-last-edited card-updated-at">
                  at {new Date(card.updated_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} {new Date(card.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })}
                </span>
              )}
            </>
          )}
          {card.created_by_username && <span className="card-by">by: {card.created_by_username}</span>}
        </div>
      </div>
    </div>
  )
}
