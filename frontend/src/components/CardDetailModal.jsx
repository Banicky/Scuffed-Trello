import { useState, useEffect, useRef } from 'react'
import Tag from './Tag.jsx'
import { apiFetch, uploadImage, assetUrl } from '../api.js'

function formatDate(iso) {
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

// Group a comment's raw reaction rows into { emoji: { count, userIds } }
function groupReactions(reactions) {
  return (reactions || []).reduce((acc, r) => {
    if (!acc[r.emoji]) acc[r.emoji] = { count: 0, userIds: [] }
    acc[r.emoji].count++
    acc[r.emoji].userIds.push(r.userId)
    return acc
  }, {})
}

export default function CardDetailModal({ card, currentUserId, onClose, onCommentCountChange }) {
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
  const overlayRef = useRef(null)
  const commentInputRef = useRef(null)
  const emojiPickerRef = useRef(null)
  const reactionPickerRef = useRef(null)
  const fileInputRef = useRef(null)

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
      const { url } = await uploadImage(file)
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
                    <div className="comment-avatar">{cm.username.charAt(0).toUpperCase()}</div>
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
        </div>
      </div>
    </div>
  )
}
