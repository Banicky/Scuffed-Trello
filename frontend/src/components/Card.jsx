import { useState } from 'react'
import Tag from './Tag.jsx'
import ImageUploadField from './ImageUploadField.jsx'
import { TAG_COLORS } from '../constants.js'
import { assetUrl } from '../api.js'

function EditCardForm({ card, onSave, onCancel }) {
  const [title, setTitle] = useState(card.title)
  const [desc, setDesc] = useState(card.description || '')
  const [tag, setTag] = useState(card.label_name || 'Design')
  const [imageUrl, setImageUrl] = useState(card.image_url || null)

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    onSave({ title: title.trim(), description: desc.trim(), label_name: tag, label_color: TAG_COLORS[tag]?.color, image_url: imageUrl })
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
      <ImageUploadField value={imageUrl} onChange={setImageUrl} />
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
export default function Card({ card, onDelete, onToggleStar, onEdit, onDragStart, onDragOverCard, isDropTarget, onOpenDetail }) {
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
      <p className="card-title card-title--clickable" onClick={onOpenDetail}>{card.title}</p>
      {card.description && <p className="card-desc card-desc--clickable" onClick={onOpenDetail}>{card.description}</p>}
      {card.image_url && (
        <img
          className="card-image-thumb"
          src={assetUrl(card.image_url)}
          alt="card attachment"
          draggable={false}
          onClick={onOpenDetail}
        />
      )}
      <div className="card-footer">
        <div className="card-footer-left">
          {card.comment_count > 0 && (
            <button
              className="card-comment-count"
              onClick={onOpenDetail}
              title={`${card.comment_count} comment${card.comment_count === 1 ? '' : 's'}`}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              <span>{card.comment_count}</span>
            </button>
          )}
          <button className="card-edit" onClick={() => setEditing(true)} title="Edit card">✎</button>
        </div>
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
