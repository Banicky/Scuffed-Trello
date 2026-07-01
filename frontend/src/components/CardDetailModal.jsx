import { useState, useEffect, useRef } from 'react'
import { apiFetch, uploadImage, assetUrl } from '../api.js'
import { socket } from '../socket.js'
import UserAvatar from './UserAvatar.jsx'

export function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const EMOJIS = [
  '😀', '😂', '😊', '😍', '😎', '🤔', '😴', '😭',
  '😅', '😉', '🙌', '👍', '👎', '👏', '🙏', '💪',
  '❤️', '🔥', '✨', '🎉', '🚀', '⭐', '✅', '❌',
]

function SmileyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5a4 4 0 0 0 7 0" />
      <line x1="9" y1="9.5" x2="9" y2="9.5" />
      <line x1="15" y1="9.5" x2="15" y2="9.5" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function AssignIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </svg>
  )
}

// Build the human-readable sentence for one history row, e.g.
// "ming moved Theme to Review from In Progress".
export function describeHistory(h) {
  const who = h.username || 'Someone'
  const title = h.card_title || 'this card'
  switch (h.action) {
    case 'created':    return `${who} created ${title}`
    case 'moved':      return `${who} moved ${title} ${h.detail || ''}`.trim()
    case 'edited':     return `${who} edited ${title}${h.detail ? ` ${h.detail}` : ''}`
    case 'assigned':   return `${who} assigned ${h.detail || 'a member'} to ${title}`
    case 'unassigned': return `${who} unassigned ${h.detail || 'a member'} from ${title}`
    default:           return `${who} ${h.action} ${title}`
  }
}

// Group a comment's raw reaction rows into { emoji: { count, userIds } }
function groupReactions(reactions) {
  return (reactions || []).reduce((acc, r) => {
    if (!acc[r.emoji]) acc[r.emoji] = { count: 0, userIds: [] }
    acc[r.emoji].count++
    acc[r.emoji].userIds.push(r.userId)
    return acc
  }, {})
}

export default function CardDetailModal({ card, boardId, currentUserId, onClose, onCommentCountChange, onAssigneesChange }) {
  const [comments, setComments] = useState([])
  const [commentBody, setCommentBody] = useState('')
  const [editingCommentId, setEditingCommentId] = useState(null)
  const [editingBody, setEditingBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [reactionPickerId, setReactionPickerId] = useState(null)
  const [pendingImage, setPendingImage] = useState(null) // { url } once uploaded
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [assignees, setAssignees] = useState(card.assignees || [])
  const [history, setHistory] = useState([])
  const [members, setMembers] = useState([])
  const [showAssignPicker, setShowAssignPicker] = useState(false)
  const overlayRef = useRef(null)
  const commentInputRef = useRef(null)
  const emojiPickerRef = useRef(null)
  const reactionPickerRef = useRef(null)
  const fileInputRef = useRef(null)
  const assignPickerRef = useRef(null)

  useEffect(() => {
    apiFetch(`/api/cards/${card.id}/comments`)
      .then(r => r.json())
      .then(data => Array.isArray(data) ? setComments(data) : setComments([]))
  }, [card.id])

  function loadHistory() {
    apiFetch(`/api/cards/${card.id}/history`)
      .then(r => r.json())
      .then(data => setHistory(Array.isArray(data) ? data : []))
  }

  useEffect(() => { loadHistory() }, [card.id])

  // Real-time: keep this card's comments, reactions, assignees and history in
  // sync with edits other members make while the modal is open. Only events for
  // THIS card are applied; the acting client is excluded server-side, so these
  // never double up with the local optimistic updates above.
  useEffect(() => {
    const onCommentCreated = ({ cardId, comment }) => {
      if (cardId !== card.id) return
      setComments(c => c.some(cm => cm.id === comment.id) ? c : [...c, comment])
    }
    const onCommentUpdated = ({ cardId, comment }) => {
      if (cardId !== card.id) return
      setComments(c => c.map(cm => cm.id === comment.id ? comment : cm))
    }
    const onCommentDeleted = ({ cardId, commentId }) => {
      if (cardId !== card.id) return
      setComments(c => c.filter(cm => cm.id !== commentId))
    }
    const onReactions = ({ cardId, commentId, reactions }) => {
      if (cardId !== card.id) return
      setComments(c => c.map(cm => cm.id === commentId ? { ...cm, reactions } : cm))
    }
    const onAssignees = ({ cardId, assignees: next }) => {
      if (cardId !== card.id) return
      setAssignees(next)
      loadHistory()
    }
    // Title/description/move edits write a history row — refresh the trail.
    const onCardUpdated = ({ card: c }) => { if (c.id === card.id) loadHistory() }

    socket.on('comment:created', onCommentCreated)
    socket.on('comment:updated', onCommentUpdated)
    socket.on('comment:deleted', onCommentDeleted)
    socket.on('comment:reactions', onReactions)
    socket.on('card:assignees', onAssignees)
    socket.on('card:updated', onCardUpdated)
    return () => {
      socket.off('comment:created', onCommentCreated)
      socket.off('comment:updated', onCommentUpdated)
      socket.off('comment:deleted', onCommentDeleted)
      socket.off('comment:reactions', onReactions)
      socket.off('card:assignees', onAssignees)
      socket.off('card:updated', onCardUpdated)
    }
  }, [card.id])

  useEffect(() => {
    if (!boardId) return
    apiFetch(`/api/boards/${boardId}/members`)
      .then(r => r.json())
      .then(data => Array.isArray(data) ? setMembers(data) : setMembers([]))
  }, [boardId])

  useEffect(() => {
    if (!showAssignPicker) return
    function handleClick(e) {
      if (assignPickerRef.current && !assignPickerRef.current.contains(e.target)) setShowAssignPicker(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showAssignPicker])

  async function toggleAssignee(member) {
    const isAssigned = assignees.some(a => a.id === member.id)
    let next
    if (isAssigned) {
      const res = await apiFetch(`/api/cards/${card.id}/assignees/${member.id}`, { method: 'DELETE' })
      if (!res.ok) return
      next = assignees.filter(a => a.id !== member.id)
    } else {
      const res = await apiFetch(`/api/cards/${card.id}/assignees`, {
        method: 'POST',
        body: JSON.stringify({ user_id: member.id }),
      })
      const data = await res.json()
      if (!res.ok) return
      next = [...assignees, data].sort((a, b) => a.username.localeCompare(b.username))
    }
    setAssignees(next)
    onAssigneesChange?.(next)
    loadHistory()
  }

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  useEffect(() => {
    if (!showEmojiPicker) return
    function handleClick(e) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target)) setShowEmojiPicker(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showEmojiPicker])

  useEffect(() => {
    if (reactionPickerId === null) return
    function handleClick(e) {
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(e.target)) setReactionPickerId(null)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [reactionPickerId])

  async function reactToComment(commentId, emoji) {
    const res = await apiFetch(`/api/comments/${commentId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    })
    const data = await res.json()
    if (res.ok) {
      setComments(c => c.map(cm => cm.id === commentId ? { ...cm, reactions: data.reactions } : cm))
    }
    setReactionPickerId(null)
  }

  function insertEmoji(emoji) {
    const input = commentInputRef.current
    const start = input ? input.selectionStart : commentBody.length
    const end = input ? input.selectionEnd : commentBody.length
    const next = commentBody.slice(0, start) + emoji + commentBody.slice(end)
    setCommentBody(next)
    setShowEmojiPicker(false)
    // restore focus and place the cursor right after the inserted emoji
    requestAnimationFrame(() => {
      if (!input) return
      input.focus()
      const pos = start + emoji.length
      input.setSelectionRange(pos, pos)
    })
  }

  async function handleSelectImage(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    setUploadError('')
    setUploading(true)
    try {
      const { url } = await uploadImage(file, 'comments')
      setPendingImage({ url })
    } catch (err) {
      setUploadError(err.message)
    }
    setUploading(false)
  }

  async function handlePostComment(e) {
    e.preventDefault()
    if ((!commentBody.trim() && !pendingImage) || submitting) return
    setSubmitting(true)
    const res = await apiFetch(`/api/cards/${card.id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: commentBody.trim(), image_url: pendingImage?.url || null }),
    })
    const data = await res.json()
    if (res.ok) {
      setComments(c => [...c, data])
      setCommentBody('')
      setPendingImage(null)
      onCommentCountChange?.(comments.length + 1)
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
    if (res.ok) {
      setComments(c => c.filter(cm => cm.id !== commentId))
      onCommentCountChange?.(comments.length - 1)
    }
  }

  return (
    <div
      className="card-modal-overlay"
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className="card-modal">
        <div className="card-modal-header">
          <h2 className="card-modal-title">{card.title}</h2>
          <div className="card-assign-wrap" ref={assignPickerRef}>
            <button
              type="button"
              className="card-assign-btn"
              title="Assign members"
              onClick={() => setShowAssignPicker(p => !p)}
            >
              <AssignIcon />
              <span>Assign</span>
            </button>
            {showAssignPicker && (
              <div className="card-assign-picker">
                <span className="card-assign-picker-label">Board members</span>
                {members.length === 0 && (
                  <p className="card-assign-empty">No board members yet.</p>
                )}
                {members.map(m => {
                  const checked = assignees.some(a => a.id === m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`card-assign-option${checked ? ' active' : ''}`}
                      onClick={() => toggleAssignee(m)}
                    >
                      <UserAvatar user={m} className="card-assign-option-avatar" />
                      <span className="card-assign-option-name">{m.username}</span>
                      {checked && <span className="card-assign-check">✓</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {assignees.length > 0 && (
          <div className="card-modal-assignees">
            <span className="card-modal-section-label">Assigned</span>
            <div className="card-assignee-chips">
              {assignees.map(a => (
                <span key={a.id} className="card-assignee-chip">
                  <UserAvatar user={a} className="card-assignee-chip-avatar" />
                  <span className="card-assignee-chip-name">{a.username}</span>
                  <button
                    type="button"
                    className="card-assignee-chip-remove"
                    title="Unassign"
                    onClick={() => toggleAssignee(a)}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="card-modal-body">
          <div className="card-modal-main">
            {card.description ? (
              <p className="card-modal-desc">{card.description}</p>
            ) : (
              <p className="card-modal-desc card-modal-desc--empty">No description.</p>
            )}

            {card.image_url && (
              <a href={assetUrl(card.image_url)} target="_blank" rel="noreferrer" className="card-modal-image-link">
                <img className="card-modal-image" src={assetUrl(card.image_url)} alt="card attachment" />
              </a>
            )}

            <div className="card-modal-comments">
              <span className="card-modal-section-label">Comments ({comments.length})</span>

              <div className="comment-list">
                {comments.length === 0 && (
                  <p className="comment-empty">No comments yet. Be the first!</p>
                )}
                {comments.map(cm => (
                  <div key={cm.id} className="comment-item">
                    <UserAvatar user={{ username: cm.username, avatar_url: cm.avatar_url }} className="comment-avatar" />
                    {editingCommentId !== cm.id && (
                      <div className="comment-reaction-add-wrap" ref={reactionPickerId === cm.id ? reactionPickerRef : null}>
                        <button
                          className="comment-reaction-add"
                          title="Add reaction"
                          onClick={() => setReactionPickerId(id => id === cm.id ? null : cm.id)}
                        >
                          <SmileyIcon />
                        </button>
                        {reactionPickerId === cm.id && (
                          <div className="emoji-picker">
                            {EMOJIS.map(emoji => (
                              <button
                                key={emoji}
                                type="button"
                                className="emoji-picker-option"
                                onClick={() => reactToComment(cm.id, emoji)}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
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
                        <>
                          {cm.body && <p className="comment-body">{cm.body}</p>}
                          {cm.image_url && (
                            <a href={assetUrl(cm.image_url)} target="_blank" rel="noreferrer" className="comment-image-link">
                              <img className="comment-image" src={assetUrl(cm.image_url)} alt="comment attachment" />
                            </a>
                          )}
                        </>
                      )}

                      {editingCommentId !== cm.id && Object.keys(groupReactions(cm.reactions)).length > 0 && (
                        <div className="comment-reactions">
                          {Object.entries(groupReactions(cm.reactions)).map(([emoji, { count, userIds }]) => (
                            <button
                              key={emoji}
                              className={`comment-reaction-pill${userIds.includes(currentUserId) ? ' active' : ''}`}
                              onClick={() => reactToComment(cm.id, emoji)}
                              title="Toggle reaction"
                            >
                              {emoji} <span>{count}</span>
                            </button>
                          ))}
                        </div>
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
                <div className="comment-input-wrap">
                  <textarea
                    ref={commentInputRef}
                    className="card-input comment-input"
                    placeholder="Write a comment…"
                    value={commentBody}
                    onChange={e => setCommentBody(e.target.value)}
                    rows={2}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePostComment(e) }
                    }}
                  />
                  <div className="comment-input-tools">
                    <button
                      type="button"
                      className="emoji-trigger-btn"
                      title="Upload image (max 5 MB)"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <PlusIcon />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={handleSelectImage}
                    />
                    <div className="emoji-picker-wrap" ref={emojiPickerRef}>
                      <button
                        type="button"
                        className="emoji-trigger-btn"
                        title="Add emoji"
                        onClick={() => setShowEmojiPicker(p => !p)}
                      >
                        <SmileyIcon />
                      </button>
                      {showEmojiPicker && (
                        <div className="emoji-picker">
                          {EMOJIS.map(emoji => (
                            <button
                              key={emoji}
                              type="button"
                              className="emoji-picker-option"
                              onClick={() => insertEmoji(emoji)}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <p className="comment-upload-disclaimer">Images are capped at max 5 MB per upload</p>

                {uploading && <p className="comment-upload-status">Uploading image…</p>}
                {uploadError && <p className="comment-upload-status comment-upload-status--error">{uploadError}</p>}
                {pendingImage && (
                  <div className="comment-image-preview">
                    <img src={assetUrl(pendingImage.url)} alt="attachment preview" />
                    <button
                      type="button"
                      className="comment-image-remove"
                      title="Remove image"
                      onClick={() => setPendingImage(null)}
                    >
                      ✕
                    </button>
                  </div>
                )}

                <button className="btn-primary" type="submit" disabled={submitting || uploading || (!commentBody.trim() && !pendingImage)}>
                  {submitting ? 'Posting…' : 'Comment'}
                </button>
              </form>
            </div>
          </div>

          <aside className="card-modal-history">
            <span className="card-modal-section-label">History</span>
            <ul className="card-history-list">
              {history.length === 0 && (
                <li className="card-history-empty">No history yet.</li>
              )}
              {history.map(h => (
                <li key={h.id} className={`card-history-item card-history-item--${h.action}`}>
                  <span className="card-history-dot" aria-hidden="true" />
                  <div className="card-history-content">
                    <p className="card-history-text">{describeHistory(h)}</p>
                    <span className="card-history-date">{formatDate(h.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </div>
  )
}
