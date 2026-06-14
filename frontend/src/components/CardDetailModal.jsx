import { useState, useEffect, useRef } from 'react'
import Tag from './Tag.jsx'
import { apiFetch } from '../api.js'

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function CardDetailModal({ card, currentUserId, onClose }) {
  const [comments, setComments] = useState([])
  const [commentBody, setCommentBody] = useState('')
  const [editingCommentId, setEditingCommentId] = useState(null)
  const [editingBody, setEditingBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const overlayRef = useRef(null)

  useEffect(() => {
    apiFetch(`/api/cards/${card.id}/comments`)
      .then(r => r.json())
      .then(data => Array.isArray(data) ? setComments(data) : setComments([]))
  }, [card.id])

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  async function handlePostComment(e) {
    e.preventDefault()
    if (!commentBody.trim() || submitting) return
    setSubmitting(true)
    const res = await apiFetch(`/api/cards/${card.id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: commentBody.trim() }),
    })
    const data = await res.json()
    if (res.ok) {
      setComments(c => [...c, data])
      setCommentBody('')
    }
    setSubmitting(false)
  }

  async function handleSaveEdit(commentId) {
    if (!editingBody.trim()) return
    const res = await apiFetch(`/api/comments/${commentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: editingBody.trim() }),
    })
    const data = await res.json()
    if (res.ok) {
      setComments(c => c.map(cm => cm.id === commentId ? data : cm))
      setEditingCommentId(null)
    }
  }

  async function handleDeleteComment(commentId) {
    const res = await apiFetch(`/api/comments/${commentId}`, { method: 'DELETE' })
    if (res.ok) setComments(c => c.filter(cm => cm.id !== commentId))
  }

  return (
    <div
      className="card-modal-overlay"
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className="card-modal">
        <div className="card-modal-header">
          <Tag label={card.label_name} color={card.label_color} />
          <h2 className="card-modal-title">{card.title}</h2>
        </div>

        <div className="card-modal-body">
          <div className="card-modal-main">
            {card.description ? (
              <p className="card-modal-desc">{card.description}</p>
            ) : (
              <p className="card-modal-desc card-modal-desc--empty">No description.</p>
            )}

            <div className="card-modal-comments">
              <span className="card-modal-section-label">Comments ({comments.length})</span>

              <div className="comment-list">
                {comments.length === 0 && (
                  <p className="comment-empty">No comments yet. Be the first!</p>
                )}
                {comments.map(cm => (
                  <div key={cm.id} className="comment-item">
                    <div className="comment-avatar">{cm.username.charAt(0).toUpperCase()}</div>
                    <div className="comment-content">
                      <div className="comment-header">
                        <span className="comment-author">{cm.username}</span>
                        <span className="comment-date">{formatDate(cm.created_at)}{cm.edited_at ? ' (edited)' : ''}</span>
                      </div>
                      {editingCommentId === cm.id ? (
                        <div className="comment-edit-form">
                          <textarea
                            className="card-input comment-edit-input"
                            value={editingBody}
                            onChange={e => setEditingBody(e.target.value)}
                            rows={2}
                            autoFocus
                          />
                          <div className="comment-edit-actions">
                            <button className="btn-primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => handleSaveEdit(cm.id)}>Save</button>
                            <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setEditingCommentId(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <p className="comment-body">{cm.body}</p>
                      )}
                      {cm.user_id === currentUserId && editingCommentId !== cm.id && (
                        <div className="comment-actions">
                          <button className="comment-action-btn" onClick={() => { setEditingCommentId(cm.id); setEditingBody(cm.body) }}>Edit</button>
                          <button className="comment-action-btn comment-action-btn--danger" onClick={() => handleDeleteComment(cm.id)}>Delete</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <form className="comment-form" onSubmit={handlePostComment}>
                <textarea
                  className="card-input comment-input"
                  placeholder="Write a comment…"
                  value={commentBody}
                  onChange={e => setCommentBody(e.target.value)}
                  rows={2}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePostComment(e) }
                  }}
                />
                <button className="btn-primary" type="submit" disabled={submitting || !commentBody.trim()}>
                  {submitting ? 'Posting…' : 'Comment'}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
