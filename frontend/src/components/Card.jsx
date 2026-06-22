import { useState } from 'react'
import ImageUploadField from './ImageUploadField.jsx'
import UserAvatar from './UserAvatar.jsx'
import { assetUrl } from '../api.js'
import { buildSearchRegex } from '../utils.js'

function highlightMatches(text, query, caseSensitive, wholeWord, isActive) {
  if (!text || !query) return text
  const regex = buildSearchRegex(query, { caseSensitive, wholeWord, flags: 'g' })
  if (!regex) return text
  const parts = []
  let lastIndex = 0
  let match
  while ((match = regex.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    parts.push(
      <mark key={match.index} className={`search-highlight${isActive ? ' active' : ''}`}>{match[0]}</mark>
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex === 0) return text
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

function EditCardForm({ card, onSave, onCancel }) {
  const [title, setTitle] = useState(card.title)
  const [desc, setDesc] = useState(card.description || '')
  const [imageUrl, setImageUrl] = useState(card.image_url || null)

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    onSave({ title: title.trim(), description: desc.trim(), image_url: imageUrl })
  }

  return (
    <form className="add-card-form" onSubmit={handleSubmit}>
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
      <ImageUploadField value={imageUrl} onChange={setImageUrl} type="cards" />
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
export default function Card({ card, onDelete, onToggleStar, onEdit, onDragStart, onDragOverCard, isDropTarget, onOpenDetail, searchQuery, caseSensitive, wholeWord, cardRef, isActiveMatch }) {
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
      ref={node => cardRef?.(card.id, node)}
      className={`kanban-card${isDropTarget ? ' drop-target' : ''}${card.starred ? ' starred' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={e => { e.preventDefault(); onDragOverCard(card.id) }}
    >
      <div className="card-header">
        <p className="card-title card-title--clickable" onClick={onOpenDetail}>
          {highlightMatches(card.title, searchQuery, caseSensitive, wholeWord, isActiveMatch)}
        </p>
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
      {card.description && (
        <p className="card-desc card-desc--clickable" onClick={onOpenDetail}>
          {highlightMatches(card.description, searchQuery, caseSensitive, wholeWord, isActiveMatch)}
        </p>
      )}
      {card.image_url && (
        <img
          className="card-image-thumb"
          src={assetUrl(card.image_url)}
          alt="card attachment"
          draggable={false}
          onClick={onOpenDetail}
        />
      )}
      {card.assignees?.length > 0 && (
        <div className="card-assignees" onClick={onOpenDetail} title="Assigned members">
          {card.assignees.map(a => (
            <UserAvatar key={a.id} user={a} className="card-assignee-avatar" />
          ))}
        </div>
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
