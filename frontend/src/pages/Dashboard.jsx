import { useState, useEffect, useRef } from 'react'
import { apiFetch, assetUrl } from '../api.js'
import { COLUMN_PALETTE } from '../constants.js'
import UserAvatar from '../components/UserAvatar.jsx'

const GUILD_COLORS = [
  { key: 'arcane',  hex: '#aa3bff' },
  { key: 'ember',   hex: '#d2461b' },
  { key: 'verdant', hex: '#22a44a' },
  { key: 'tidal',   hex: '#0ea5e9' },
  { key: 'gilded',  hex: '#c98a0a' },
  { key: 'frost',   hex: '#7dd3fc' },
]

function guildHex(iconColor) {
  return GUILD_COLORS.find(c => c.key === iconColor)?.hex || '#aa3bff'
}

function GuildIcon({ guild, className = '' }) {
  const initial = (guild.name?.trim()[0] || '?').toUpperCase()
  return (
    <span
      className={`guild-icon ${className}`}
      style={{ '--guild-color': guildHex(guild.icon_color) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  )
}

function CreateGuildModal({ onClose, onCreate }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('arcane')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const overlayRef = useRef(null)

  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    const res = await apiFetch('/api/guilds', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), icon_color: color }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Failed to create guild'); setBusy(false); return }
    onCreate(data)
    onClose()
  }

  return (
    <div
      className="card-modal-overlay"
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className="card-modal guild-modal" role="dialog" aria-modal="true" aria-label="Form a Guild">
        <div className="card-modal-header">
          <h2 className="guild-modal-title">Form a Guild</h2>
        </div>
        <div className="card-modal-body">
          <form onSubmit={handleSubmit} className="guild-modal-form">
            <div>
              <label className="guild-field-label">Guild Name</label>
              <input
                className="card-input"
                placeholder="e.g. Dragon Slayers"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
                maxLength={60}
              />
            </div>
            <div>
              <label className="guild-field-label">Emblem Color</label>
              <div className="guild-color-picker">
                {GUILD_COLORS.map(c => (
                  <button
                    key={c.key}
                    type="button"
                    className={`guild-color-swatch${color === c.key ? ' active' : ''}`}
                    style={{ '--swatch': c.hex }}
                    onClick={() => setColor(c.key)}
                    aria-label={c.key}
                    aria-pressed={color === c.key}
                  />
                ))}
              </div>
            </div>
            <div className="guild-preview">
              <GuildIcon guild={{ name: name || '?', icon_color: color }} className="guild-icon--lg" />
              <span className="guild-preview-name">{name || 'Unnamed Guild'}</span>
            </div>
            {error && <p className="auth-error">{error}</p>}
            <div className="guild-modal-actions">
              <button className="btn-primary" type="submit" disabled={busy || !name.trim()}>
                {busy ? 'Forming…' : 'Form Guild'}
              </button>
              <button className="btn-ghost" type="button" onClick={onClose}>Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function GuildSettingsModal({ guild, currentUserId, onClose, onUpdate, onDelete, onMemberAdd, onMemberRemove }) {
  const [tab, setTab] = useState('members')
  const [members, setMembers] = useState(guild.members || [])
  const [addInput, setAddInput] = useState('')
  const [addError, setAddError] = useState(null)
  const [adding, setAdding] = useState(false)
  const [renameVal, setRenameVal] = useState(guild.name)
  const [iconColor, setIconColor] = useState(guild.icon_color)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const overlayRef = useRef(null)

  const isOwner = guild.owner_id === currentUserId

  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  async function handleAddMember(e) {
    e.preventDefault()
    if (!addInput.trim()) return
    setAdding(true)
    setAddError(null)
    const res = await apiFetch(`/api/guilds/${guild.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: addInput.trim() }),
    })
    const data = await res.json()
    if (!res.ok) { setAddError(data.error || 'Failed'); setAdding(false); return }
    setMembers(m => [...m, data])
    onMemberAdd(data)
    setAddInput('')
    setAdding(false)
  }

  async function handleRemoveMember(userId) {
    await apiFetch(`/api/guilds/${guild.id}/members/${userId}`, { method: 'DELETE' })
    setMembers(m => m.filter(x => x.id !== userId))
    onMemberRemove(userId)
  }

  async function handleSaveSettings(e) {
    e.preventDefault()
    if (!renameVal.trim()) return
    setSaving(true)
    const res = await apiFetch(`/api/guilds/${guild.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: renameVal.trim(), icon_color: iconColor }),
    })
    const data = await res.json()
    setSaving(false)
    if (res.ok) { onUpdate({ ...data, members }); onClose() }
  }

  async function handleDelete() {
    await apiFetch(`/api/guilds/${guild.id}`, { method: 'DELETE' })
    onDelete(guild.id)
    onClose()
  }

  return (
    <div
      className="card-modal-overlay"
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className="card-modal guild-settings-modal" role="dialog" aria-modal="true" aria-label="Guild Settings">
        <div className="guild-settings-header">
          <GuildIcon guild={{ name: guild.name, icon_color: iconColor }} className="guild-icon--md" />
          <div>
            <h2 className="guild-modal-title">{guild.name}</h2>
            <p className="guild-settings-sub">
              {members.length} member{members.length !== 1 ? 's' : ''}
              {guild.board_count != null ? ` · ${guild.board_count} board${guild.board_count !== 1 ? 's' : ''}` : ''}
            </p>
          </div>
        </div>

        <div className="guild-settings-tabs">
          <button
            className={`guild-settings-tab${tab === 'members' ? ' active' : ''}`}
            onClick={() => setTab('members')}
          >
            Members
          </button>
          {isOwner && (
            <button
              className={`guild-settings-tab${tab === 'settings' ? ' active' : ''}`}
              onClick={() => setTab('settings')}
            >
              Settings
            </button>
          )}
        </div>

        <div className="guild-settings-body">
          {tab === 'members' && (
            <div>
              {isOwner && (
                <form className="guild-add-form" onSubmit={handleAddMember}>
                  <input
                    className="card-input guild-add-input"
                    placeholder="Add by username or email"
                    value={addInput}
                    onChange={e => setAddInput(e.target.value)}
                  />
                  <button className="btn-primary" type="submit" disabled={adding || !addInput.trim()}>
                    {adding ? '…' : 'Add'}
                  </button>
                </form>
              )}
              {addError && <p className="auth-error" style={{ marginBottom: 8 }}>{addError}</p>}
              <ul className="guild-member-list">
                {members.map(m => (
                  <li key={m.id} className="guild-member-item">
                    <UserAvatar user={m} className="guild-member-avatar" />
                    <span className="guild-member-name">{m.username}</span>
                    {m.role === 'owner' && <span className="guild-member-role">Owner</span>}
                    {isOwner && m.id !== currentUserId && m.role !== 'owner' && (
                      <button
                        className="guild-member-remove"
                        onClick={() => handleRemoveMember(m.id)}
                        title={`Remove ${m.username}`}
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === 'settings' && isOwner && (
            <form className="guild-settings-form" onSubmit={handleSaveSettings}>
              <div>
                <label className="guild-field-label">Guild Name</label>
                <input
                  className="card-input"
                  value={renameVal}
                  onChange={e => setRenameVal(e.target.value)}
                  maxLength={60}
                />
              </div>
              <div>
                <label className="guild-field-label">Emblem Color</label>
                <div className="guild-color-picker">
                  {GUILD_COLORS.map(c => (
                    <button
                      key={c.key}
                      type="button"
                      className={`guild-color-swatch${iconColor === c.key ? ' active' : ''}`}
                      style={{ '--swatch': c.hex }}
                      onClick={() => setIconColor(c.key)}
                      aria-label={c.key}
                      aria-pressed={iconColor === c.key}
                    />
                  ))}
                </div>
              </div>
              <button className="btn-primary" type="submit" disabled={saving || !renameVal.trim()}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <div className="guild-settings-divider" />
              {confirming ? (
                <div className="guild-settings-confirm">
                  <p>This disbands the guild and unassigns all its boards. Continue?</p>
                  <div className="board-popover-confirm-actions">
                    <button type="button" className="btn-danger-sm" onClick={handleDelete}>Disband</button>
                    <button type="button" className="btn-ghost-sm" onClick={() => setConfirming(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="board-popover-delete" onClick={() => setConfirming(true)}>
                  Disband Guild
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

function UserMenu({ user, onOpenSettings, onLogout }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const isPreset = user.avatar_url?.startsWith('preset:')
  const presetKey = isPreset ? user.avatar_url.slice(7) : null
  const hasImage = user.avatar_url && !isPreset
  const initial = (user.username[0] || '?').toUpperCase()

  return (
    <div className="user-menu" ref={ref}>
      <button
        className="user-menu-trigger"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className="user-menu-avatar">
          {hasImage
            ? <img src={assetUrl(user.avatar_url)} alt="" />
            : <span>{presetKey ?? initial}</span>
          }
        </span>
        <span className="user-menu-name">{user.username}</span>
        <span className="user-menu-chevron" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="user-menu-popover" role="menu">
          <button className="user-menu-item" role="menuitem" onClick={() => { setOpen(false); onOpenSettings('avatar') }}>
            <span className="user-menu-item-icon" aria-hidden="true">✦</span>
            Change Avatar
          </button>
          <button className="user-menu-item" role="menuitem" onClick={() => { setOpen(false); onOpenSettings('customization') }}>
            <span className="user-menu-item-icon" aria-hidden="true">⚙</span>
            Customization
          </button>
          <button className="user-menu-item" role="menuitem" onClick={() => { setOpen(false); onOpenSettings('security') }}>
            <span className="user-menu-item-icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 1 1 8 0v4" />
              </svg>
            </span>
            Security
          </button>
          <div className="user-menu-divider" role="separator" />
          <button className="user-menu-item user-menu-item--danger" role="menuitem" onClick={() => { setOpen(false); onLogout() }}>
            <span className="user-menu-item-icon" aria-hidden="true">⇥</span>
            Log out
          </button>
        </div>
      )}
    </div>
  )
}

const previewCache = new Map()

function relativeTime(iso) {
  if (!iso) return null
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 45) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`
  const wk = Math.round(day / 7)
  if (wk < 5) return `${wk}w ago`
  const mo = Math.round(day / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.round(day / 365)}y ago`
}

function BoardSettingsPopover({ board, onRename, onDelete, onClose }) {
  const [renameVal, setRenameVal] = useState(board.title)
  const [confirming, setConfirming] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  function handleRename(e) {
    e.preventDefault()
    if (!renameVal.trim() || renameVal.trim() === board.title) return onClose()
    onRename(board.id, renameVal.trim())
    onClose()
  }

  return (
    <div className="board-popover" ref={ref} onClick={e => e.stopPropagation()}>
      <p className="board-popover-label">Rename board</p>
      <form className="board-popover-rename" onSubmit={handleRename}>
        <input
          className="card-input"
          value={renameVal}
          onChange={e => setRenameVal(e.target.value)}
          autoFocus
        />
        <button className="btn-primary" type="submit">Save</button>
      </form>
      <div className="board-popover-divider" />
      {confirming ? (
        <div className="board-popover-confirm">
          <span className="board-popover-confirm-msg">Delete this board?</span>
          <div className="board-popover-confirm-actions">
            <button className="btn-danger-sm" onClick={() => { onDelete(board.id); onClose() }}>Delete</button>
            <button className="btn-ghost-sm" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="board-popover-delete" onClick={() => setConfirming(true)}>
          Delete board
        </button>
      )}
    </div>
  )
}

function BoardCard({ board, index, stagger, onOpen, onDelete, onRename, isOwner }) {
  const [showSettings, setShowSettings] = useState(false)
  const color = COLUMN_PALETTE[index % COLUMN_PALETTE.length]
  const monogram = (board.title.trim()[0] || '?').toUpperCase()
  const lastOpened = relativeTime(board.last_accessed_at)

  const members = board.members || []
  const shownMembers = members.slice(0, 4)
  const extraMembers = members.length - shownMembers.length

  const counts = board.column_counts?.length ? board.column_counts.slice(0, 6) : [0, 0, 0]
  const maxCount = Math.max(...counts, 1)

  const [preview, setPreview] = useState(() => previewCache.get(board.id) || null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const hoverTimer = useRef(null)

  useEffect(() => () => clearTimeout(hoverTimer.current), [])

  async function loadPreview() {
    if (previewCache.has(board.id)) { setPreview(previewCache.get(board.id)); return }
    setPreviewLoading(true)
    try {
      const res = await apiFetch(`/api/boards/${board.id}/preview`)
      const data = await res.json()
      if (res.ok && Array.isArray(data.columns)) {
        previewCache.set(board.id, data.columns)
        setPreview(data.columns)
      }
    } catch { /* leave preview empty on failure */ }
    setPreviewLoading(false)
  }

  function openPreview() {
    if (showSettings) return
    clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => { setPreviewOpen(true); loadPreview() }, 320)
  }
  function closePreview(e) {
    clearTimeout(hoverTimer.current)
    setPreviewOpen(false)
    e?.currentTarget?.style.setProperty('--mx', '50%')
    e?.currentTarget?.style.setProperty('--my', '0%')
  }

  function trackTorch(e) {
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * 100
    const y = ((e.clientY - r.top) / r.height) * 100
    e.currentTarget.style.setProperty('--mx', `${x}%`)
    e.currentTarget.style.setProperty('--my', `${y}%`)
  }

  return (
    <div
      className="board-tile"
      style={{ '--tile': color, '--stagger': stagger }}
      onClick={() => !showSettings && onOpen(board.id, color)}
      onMouseEnter={openPreview}
      onMouseLeave={closePreview}
      onMouseMove={trackTorch}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !showSettings) { e.preventDefault(); onOpen(board.id, color) } }}
    >
      <div className="board-tile-face" aria-hidden="true">
        {board.background_image && (
          <div
            className="board-tile-bg"
            style={{
              backgroundImage: `url(${assetUrl(board.background_image)})`,
              opacity: (board.background_opacity ?? 10) / 100,
            }}
          />
        )}
        <div className="board-tile-columns">
          {counts.map((c, i) => (
            <span key={i} style={{ height: `${18 + (c / maxCount) * 62}%` }} />
          ))}
        </div>
        <span className="board-tile-monogram">{monogram}</span>
      </div>

      <div className="board-tile-top">
        {!isOwner && <span className="board-tile-tag">Shared</span>}
        {isOwner && (
          <div className="board-tile-actions" onClick={e => e.stopPropagation()}>
            <button
              className={`board-tile-btn${showSettings ? ' active' : ''}`}
              title="Board settings"
              onClick={() => setShowSettings(v => !v)}
            >
              ⚙
            </button>
          </div>
        )}
      </div>

      <div className="board-tile-info">
        <span className="board-tile-arrow" aria-hidden="true">→</span>
        <div className="board-tile-info-text">
          {board.guild_name && (
            <span
              className="board-tile-guild-chip"
              style={{ '--chip-color': guildHex(board.guild_icon_color) }}
            >
              {board.guild_name}
            </span>
          )}
          <span className="board-tile-title">{board.title}</span>
          <span className="board-tile-meta">
            {lastOpened ? `Opened ${lastOpened}` : 'Not opened yet'}
          </span>
        </div>
        {members.length > 0 && (
          <div
            className="board-tile-members"
            aria-label={`Members: ${members.map(m => m.username).join(', ')}`}
          >
            {shownMembers.map(m => (
              <UserAvatar key={m.id} user={m} className="board-tile-avatar" />
            ))}
            {extraMembers > 0 && (
              <span className="board-tile-avatar board-tile-avatar--more" title={`${extraMembers} more`}>
                +{extraMembers}
              </span>
            )}
          </div>
        )}
      </div>

      {previewOpen && !showSettings && (
        <div className="board-preview" aria-hidden="true">
          {previewLoading && !preview ? (
            <div className="board-preview-state">Loading preview…</div>
          ) : preview && preview.length === 0 ? (
            <div className="board-preview-state">No lists yet.</div>
          ) : preview ? (
            <div className="board-preview-board">
              {preview.slice(0, 6).map((col, ci) => (
                <div className="mini-col" key={col.id}>
                  <div className="mini-col-head">
                    <span className="mini-col-dot" style={{ background: COLUMN_PALETTE[ci % COLUMN_PALETTE.length] }} />
                    <span className="mini-col-title">{col.title}</span>
                    <span className="mini-col-count">{col.card_count}</span>
                  </div>
                  <div className="mini-col-cards">
                    {col.cards.map(c => (
                      <div className="mini-card" key={c.id}>
                        {c.color && <span className="mini-card-tag" style={{ background: c.color }} />}
                        <span className="mini-card-title">{c.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {showSettings && (
        <BoardSettingsPopover
          board={board}
          onRename={onRename}
          onDelete={onDelete}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}

function GuildInviteModal({ guild, onClose }) {
  const [username, setUsername] = useState('')
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const overlayRef = useRef(null)

  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  async function handleSend(e) {
    e.preventDefault()
    if (!username.trim()) return
    setStatus('sending')
    setError(null)
    const res = await apiFetch(`/api/guilds/${guild.id}/invites`, {
      method: 'POST',
      body: JSON.stringify({ username: username.trim() }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setStatus(null); return }
    setStatus('sent')
  }

  return (
    <div className="card-modal-overlay" ref={overlayRef} onClick={e => { if (e.target === overlayRef.current) onClose() }}>
      <div className="card-modal guild-invite-modal" role="dialog" aria-modal="true" aria-label="Summon Allies">
        <div className="card-modal-header">
          <h2 className="guild-modal-title">Summon Allies</h2>
        </div>
        <div className="card-modal-body">
          <p className="guild-invite-desc">
            Dispatch a missive to invite a warrior to <strong>{guild.name}</strong>.
          </p>
          {status === 'sent' ? (
            <div className="guild-invite-sent">
              <span className="guild-invite-sent-icon">✦</span>
              <span className="guild-invite-sent-text">Missive Dispatched!</span>
              <p className="guild-invite-sent-sub">They shall receive the summons shortly.</p>
              <button className="btn-ghost" onClick={() => { setStatus(null); setUsername('') }}>
                Invite Another
              </button>
            </div>
          ) : (
            <form className="guild-invite-form" onSubmit={handleSend}>
              <input
                className="card-input"
                placeholder="Username or email"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoFocus
              />
              {error && <p className="auth-error">{error}</p>}
              <div className="guild-modal-actions">
                <button className="btn-primary" type="submit" disabled={status === 'sending' || !username.trim()}>
                  {status === 'sending' ? 'Dispatching…' : 'Send Missive'}
                </button>
                <button className="btn-ghost" type="button" onClick={onClose}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

function NotificationItem({ notif, onAccept, onDecline }) {
  const d = notif.data || {}
  if (notif.type !== 'guild_invite') return null
  return (
    <div className={`notif-item${notif.read ? ' notif-item--read' : ''}`}>
      <div className="notif-item-sigil" aria-hidden="true">⚔</div>
      <div className="notif-item-body">
        <p className="notif-item-text">
          <strong>{d.inviter_username}</strong> summons you to join the guild <strong>{d.guild_name}</strong>.
        </p>
        <p className="notif-item-time">{relativeTime(notif.created_at) || 'just now'}</p>
        {!notif.read && (
          <div className="notif-item-actions">
            <button className="notif-accept-btn" onClick={() => onAccept(notif)}>Answer the Call</button>
            <button className="notif-decline-btn" onClick={() => onDecline(notif)}>Refuse</button>
          </div>
        )}
      </div>
    </div>
  )
}

function BoardTileSkeleton() {
  return (
    <div className="board-tile board-tile--skeleton" aria-hidden="true">
      <span className="skeleton-bar skeleton-bar--title" />
      <span className="skeleton-bar skeleton-bar--meta" />
    </div>
  )
}

function readSkeletonCount(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 12) : fallback
  } catch {
    return fallback
  }
}

const DASH_STARS = [
  { left: '21%', top: 72,  size: 4, dur: 6.4, delay: 0.0 },
  { left: '33%', top: 92,  size: 3, dur: 5.8, delay: 2.6 },
  { left: '44%', top: 62,  size: 5, dur: 7.2, delay: 1.1 },
  { left: '54%', top: 100, size: 3, dur: 6.2, delay: 4.0 },
  { left: '63%', top: 76,  size: 4, dur: 6.8, delay: 0.7 },
]

export default function Dashboard({ user, onOpenBoard, onLogout, onOpenSettings }) {
  const sidebarRef = useRef(null)
  const mainRef = useRef(null)
  const searchRef = useRef(null)
  const searchInputRef = useRef(null)
  const notifRef = useRef(null)

  const [boards, setBoards] = useState([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [addingBoard, setAddingBoard] = useState(false)

  // Guild state
  const [guilds, setGuilds] = useState([])
  const [activeContext, setActiveContext] = useState('personal') // 'personal' | guildId (number)
  const [guildBoards, setGuildBoards] = useState([])
  const [guildBoardsLoading, setGuildBoardsLoading] = useState(false)
  const [guildDetails, setGuildDetails] = useState(null)
  const [showCreateGuild, setShowCreateGuild] = useState(false)
  const [showGuildSettings, setShowGuildSettings] = useState(false)

  const ownedKey = `dash:${user.id}:ownedCount`
  const sharedKey = `dash:${user.id}:sharedCount`
  const [skeletonOwned] = useState(() => readSkeletonCount(ownedKey, 3))
  const [skeletonShared] = useState(() => readSkeletonCount(sharedKey, 2))

  const [boardView, setBoardView] = useState('owned') // 'owned' | 'shared'
  const [viewFlipping, setViewFlipping] = useState(false)

  const [dashSearchQuery, setDashSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [notifOpen, setNotifOpen] = useState(false)
  const [showGuildInvite, setShowGuildInvite] = useState(false)
  const [inviteTargetGuild, setInviteTargetGuild] = useState(null)
  const [recentSearches, setRecentSearches] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`dash:${user.id}:recentSearches`) || '[]') } catch { return [] }
  })

  function toggleBoardView() {
    if (viewFlipping) return
    setViewFlipping(true)
    setTimeout(() => setBoardView(v => v === 'owned' ? 'shared' : 'owned'), 150)
    setTimeout(() => setViewFlipping(false), 300)
  }

  function submitSearch(q) {
    if (!q.trim()) return
    setRecentSearches(prev => {
      const next = [q.trim(), ...prev.filter(s => s !== q.trim())].slice(0, 6)
      try { localStorage.setItem(`dash:${user.id}:recentSearches`, JSON.stringify(next)) } catch {}
      return next
    })
  }

  async function handleAcceptInvite(notif) {
    const res = await apiFetch(`/api/guild-invites/${notif.data.invite_id}/accept`, { method: 'POST' })
    const data = await res.json()
    if (!res.ok) return
    setGuilds(gs => gs.find(g => g.id === data.guild.id) ? gs : [...gs, data.guild])
    setNotifications(ns => ns.map(n => n.id === notif.id ? { ...n, read: true } : n))
    setNotifOpen(false)
  }

  async function handleDeclineInvite(notif) {
    await apiFetch(`/api/guild-invites/${notif.data.invite_id}/decline`, { method: 'POST' })
    setNotifications(ns => ns.map(n => n.id === notif.id ? { ...n, read: true } : n))
  }

  async function markAllRead() {
    await apiFetch('/api/notifications/read-all', { method: 'POST' })
    setNotifications(ns => ns.map(n => ({ ...n, read: true })))
  }

  useEffect(() => {
    const els = [sidebarRef.current, mainRef.current].filter(Boolean)
    const timers = new Map()
    function onScroll(e) {
      const el = e.currentTarget
      el.classList.add('is-scrolling')
      clearTimeout(timers.get(el))
      timers.set(el, setTimeout(() => el.classList.remove('is-scrolling'), 1000))
    }
    els.forEach(el => el.addEventListener('scroll', onScroll, { passive: true }))
    return () => {
      els.forEach(el => el.removeEventListener('scroll', onScroll))
      timers.forEach(t => clearTimeout(t))
    }
  }, [])

  useEffect(() => {
    if (!searchOpen) return
    function handleClick(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        if (!dashSearchQuery.trim()) setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [searchOpen, dashSearchQuery])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    async function fetchNotifs() {
      try {
        const res = await apiFetch('/api/notifications')
        if (res.ok) setNotifications(await res.json())
      } catch {}
    }
    fetchNotifs()
    const id = setInterval(fetchNotifs, 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!notifOpen) return
    function handle(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [notifOpen])

  useEffect(() => {
    apiFetch('/api/boards')
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : []
        setBoards(list)
        setLoading(false)
        try {
          localStorage.setItem(ownedKey, list.filter(b => b.role === 'owner').length)
          localStorage.setItem(sharedKey, list.filter(b => b.role === 'member').length)
        } catch { /* ignore storage failures */ }
      })
  }, [])

  useEffect(() => {
    apiFetch('/api/guilds')
      .then(r => r.json())
      .then(data => setGuilds(Array.isArray(data) ? data : []))
  }, [])

  useEffect(() => {
    if (activeContext === 'personal') {
      setGuildBoards([])
      setGuildDetails(null)
      return
    }
    setGuildBoardsLoading(true)
    Promise.all([
      apiFetch(`/api/guilds/${activeContext}/boards`).then(r => r.json()),
      apiFetch(`/api/guilds/${activeContext}`).then(r => r.json()),
    ]).then(([boardsData, detailsData]) => {
      setGuildBoards(Array.isArray(boardsData) ? boardsData : [])
      setGuildDetails(detailsData?.id ? detailsData : null)
      setGuildBoardsLoading(false)
    })
  }, [activeContext])

  async function createBoard(e) {
    e.preventDefault()
    if (!newTitle.trim()) return
    const body = { title: newTitle.trim() }
    if (activeContext !== 'personal') body.guild_id = activeContext
    const res = await apiFetch('/api/boards', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const board = await res.json()
    if (activeContext === 'personal') {
      setBoards(b => [...b, board])
    } else {
      setGuildBoards(b => [...b, board])
      setGuilds(gs => gs.map(g => g.id === activeContext ? { ...g, board_count: (g.board_count || 0) + 1 } : g))
    }
    setNewTitle('')
    setAddingBoard(false)
  }

  async function deleteBoard(boardId) {
    await apiFetch(`/api/boards/${boardId}`, { method: 'DELETE' })
    setBoards(b => b.filter(board => board.id !== boardId))
  }

  async function deleteGuildBoard(boardId) {
    await apiFetch(`/api/boards/${boardId}`, { method: 'DELETE' })
    setGuildBoards(b => b.filter(board => board.id !== boardId))
    setGuilds(gs => gs.map(g => g.id === activeContext ? { ...g, board_count: Math.max(0, (g.board_count || 0) - 1) } : g))
  }

  async function renameBoard(boardId, newTitle) {
    const res = await apiFetch(`/api/boards/${boardId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: newTitle }),
    })
    const updated = await res.json()
    setBoards(b => b.map(board => board.id === boardId ? { ...board, title: updated.title } : board))
  }

  async function renameGuildBoard(boardId, newTitle) {
    const res = await apiFetch(`/api/boards/${boardId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: newTitle }),
    })
    const updated = await res.json()
    setGuildBoards(b => b.map(board => board.id === boardId ? { ...board, title: updated.title } : board))
  }

  const ownedBoards = boards.filter(b => b.role === 'owner')
  const sharedBoards = boards.filter(b => b.role === 'member')

  const unreadCount = notifications.filter(n => !n.read).length

  const filteredOwned = dashSearchQuery.trim()
    ? ownedBoards.filter(b => b.title.toLowerCase().includes(dashSearchQuery.toLowerCase()))
    : ownedBoards

  const filteredShared = dashSearchQuery.trim()
    ? sharedBoards.filter(b => b.title.toLowerCase().includes(dashSearchQuery.toLowerCase()))
    : sharedBoards

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const today = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })

  const personalSummary = loading
    ? 'Loading your boards…'
    : ownedBoards.length === 0 && sharedBoards.length === 0
      ? 'No boards yet — make your first one to get rolling.'
      : <>
          {`${ownedBoards.length} board${ownedBoards.length === 1 ? '' : 's'}`}
          {sharedBoards.length ? ` · ${sharedBoards.length} shared with you` : ''}
          {' · '}<em className="dash-hero-cta">choose your journey.</em>
        </>

  const guildSummary = guildDetails
    ? `${guildBoards.length} board${guildBoards.length !== 1 ? 's' : ''} · ${(guildDetails.members || []).length} member${(guildDetails.members || []).length !== 1 ? 's' : ''} · your guild's shared quests.`
    : 'Loading guild…'

  const isPersonal = activeContext === 'personal'

  return (
    <div className="dashboard-shell">
      <div className="dash-stars" aria-hidden="true">
        {DASH_STARS.map((s, i) => (
          <span
            key={i}
            className="dash-star"
            style={{
              left: s.left,
              top: s.top,
              width: s.size,
              height: s.size,
              animationDuration: `${s.dur}s`,
              animationDelay: `${s.delay}s`,
            }}
          />
        ))}
      </div>
      <div className="sky-comet" aria-hidden="true">
        <div className="sky-comet-streak" />
      </div>

      <div className="dash-mountains" aria-hidden="true">
        <svg viewBox="0 0 1440 300" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            {/* Clip snow to mountain silhouettes so nothing bleeds into sky */}
            <clipPath id="nearMtnClip">
              <path d="M240 300 L240 254 Q350 240 450 220 Q540 202 606 178 Q660 158 706 132 Q742 110 768 84 Q790 62 810 44 Q828 28 848 38 Q866 50 886 72 Q910 98 952 116 Q996 134 1054 120 Q1108 106 1160 118 Q1254 134 1380 146 L1440 150 L1440 300 Z" />
            </clipPath>
            {/* Snow gradient: white at apex fading to soft lavender */}
            <linearGradient id="snowCapGrad" x1="50%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%"   stopColor="#ffffff" stopOpacity="1" />
              <stop offset="55%"  stopColor="#ede5ff" stopOpacity="0.97" />
              <stop offset="100%" stopColor="#c0aadf" stopOpacity="0.42" />
            </linearGradient>
            {/* Glint streak from peak trending right */}
            <linearGradient id="snowGlint" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.92" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Far range — distant rolling ridge */}
          <path className="mtn-far" d="M0 300 L0 215 Q180 208 360 202 Q540 196 700 190 Q860 184 1020 178 Q1180 172 1320 168 L1440 165 L1440 300 Z" />
          {/* Mid range — sharper peaks emerging center-right */}
          <path className="mtn-mid" d="M0 300 L0 245 Q120 234 240 222 Q360 210 460 194 Q560 178 650 158 Q720 142 768 118 Q802 100 836 78 Q858 62 878 74 Q898 88 930 105 Q966 124 1030 116 Q1094 108 1158 120 Q1280 138 1440 148 L1440 300 Z" />
          {/* Near range — hero silhouette, tallest peak center-right */}
          <path className="mtn-near" d="M240 300 L240 254 Q350 240 450 220 Q540 202 606 178 Q660 158 706 132 Q742 110 768 84 Q790 62 810 44 Q828 28 848 38 Q866 50 886 72 Q910 98 952 116 Q996 134 1054 120 Q1108 106 1160 118 Q1254 134 1380 146 L1440 150 L1440 300 Z" />

          {/* ── Near-peak snow (clipped to near mountain so the sides follow the slope) ── */}
          <g clipPath="url(#nearMtnClip)">
            {/* Main body: top runs above the ridge (clipped away) so the upper edge IS the
                mountain crest; only the lower snowline is shaped — it drapes down each
                slope and lifts into a soft, shallow notch over the centre ridge */}
            <path fill="url(#snowCapGrad)" d="M 752 24 Q 786 -4 828 -6 Q 874 -4 916 26 L 900 96 Q 893 82 884 86 Q 875 91 866 83 Q 858 73 849 66 Q 841 63 834 65 Q 828 63 822 65 Q 814 71 803 82 Q 795 88 786 80 Q 776 82 766 98 Z" />
            {/* Snow blankets draping along each slope — outer edge runs into the sky so the
                clip trims it to the exact slope line; inner edge offsets into the face */}
            <path fill="url(#snowCapGrad)" fillOpacity="0.72" d="M 805 38 Q 788 53 770 70 Q 752 87 734 104 Q 717 119 700 134 L 710 150 Q 726 135 742 120 Q 759 107 776 94 Q 791 81 806 68 Z" />
            <path fill="url(#snowCapGrad)" fillOpacity="0.9" d="M 852 40 Q 861 46 870 52 Q 881 64 892 76 Q 904 88 916 100 Q 930 107 944 111 L 936 126 Q 922 117 908 108 Q 896 97 884 86 Q 873 75 862 64 Z" />
            {/* Shadow face — left of the crest in cold blue-violet shade */}
            <path fill="rgba(50,18,110,0.30)" d="M 828 -6 Q 786 -4 752 24 L 766 98 Q 776 82 786 80 Q 795 88 803 82 Q 814 71 822 65 Q 827 63 829 64 Z" />
            {/* Glint — bright highlight running down the right of the crest */}
            <path fill="url(#snowGlint)" d="M 828 -6 Q 845 20 854 44 Q 861 62 866 78 Q 858 66 850 50 Q 840 30 828 -6 Z" />
            {/* Crevice lines — subtle surface texture flowing down the faces */}
            <path d="M 818 24 Q 812 48 807 74" fill="none" stroke="rgba(155,130,205,0.40)" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M 829 18 Q 828 44 830 70" fill="none" stroke="rgba(190,175,230,0.24)" strokeWidth="0.9" strokeLinecap="round" />
            <path d="M 838 24 Q 844 48 849 74" fill="none" stroke="rgba(255,255,255,0.20)" strokeWidth="0.9" strokeLinecap="round" />
          </g>

          {/* ── A small expedition of knights climbing toward the summit (outside the
                clip so their bodies rise above the snowline; medium tone reads against
                both snow and dark mountain) ── */}
          <g className="dash-walkers" aria-hidden="true">
            {/* Summit — a knight planting a pennant */}
            <g className="dash-walker" transform="translate(849 41) scale(0.85)">
              <path d="M -1.1 0 L 0 -3 L 1.1 0 M 0 -3 L 0 -6 M 0 -5.4 L -1.2 -4.5 M 0 -5.4 L 1.3 -5" />
              <circle className="dash-walker-fill" cx="0" cy="-7" r="1.2" />
              <path d="M 1.5 0.5 L 1.3 -9" />
              <path className="dash-walker-pennant" d="M 1.3 -9 L 4.4 -8.1 L 1.3 -6.8 Z" />
            </g>
            {/* Looking around, spear planted */}
            <g className="dash-walker" transform="translate(872 58) scale(0.85)">
              <path d="M -1.2 0 L 0 -3 L 1.2 0 M 0 -3 L 0 -6 M 0 -5.4 L 1.3 -4.6 M 0 -5.4 L -1 -6.6" />
              <circle className="dash-walker-fill" cx="0" cy="-7" r="1.2" />
              <path d="M 1.5 0.4 L 1.1 -8.5" />
            </g>
            {/* Climbing, hunched over a staff */}
            <g className="dash-walker" transform="translate(895 78) scale(0.85)">
              <path d="M -1.4 0 L -0.2 -2.6 L 1.1 -0.2 M -0.2 -2.6 L -1 -5 M -1 -5 L -1.9 -4 M -1 -5 L 0.3 -4.3 M -2.1 0.6 L -1.5 -6.2" />
              <circle className="dash-walker-fill" cx="-1.6" cy="-5.9" r="1.15" />
            </g>
            {/* Running up the slope */}
            <g className="dash-walker" transform="translate(920 100) scale(0.85)">
              <path d="M -2 0 L -0.4 -3 L 1.3 -0.4 M -0.4 -3 L -1.1 -5.8 M -1.8 -4.2 L -0.9 -5.2 L 0.6 -5.2" />
              <circle className="dash-walker-fill" cx="-1.5" cy="-6.7" r="1.2" />
            </g>
            {/* Climber on the left ridge, mirrored to face the peak */}
            <g className="dash-walker" transform="translate(802 66) scale(-0.85 0.85)">
              <path d="M -1.4 0 L -0.2 -2.6 L 1.1 -0.2 M -0.2 -2.6 L -1 -5 M -1 -5 L -1.9 -4 M -1 -5 L 0.3 -4.3 M -2.1 0.6 L -1.5 -6.2" />
              <circle className="dash-walker-fill" cx="-1.6" cy="-5.9" r="1.15" />
            </g>
          </g>
        </svg>
      </div>

      <header className="topbar">
        <div className="topbar-left">
          <p className="topbar-breadcrumb">DASHBOARD › {isPersonal ? 'MY BOARDS' : (guildDetails?.name?.toUpperCase() || 'GUILD')}</p>
          <h1 className="topbar-page-title">{isPersonal ? 'My Boards' : (guildDetails?.name || 'Guild')}</h1>
        </div>
        <div className="topbar-right">
          <div
            className={`dash-searchbar-wrap${searchOpen ? ' open' : ''}`}
            ref={searchRef}
          >
            <button
              className="dash-search-icon-btn"
              aria-label="Search boards"
              aria-expanded={searchOpen}
              onClick={() => {
                if (!searchOpen) setSearchOpen(true)
                else if (!dashSearchQuery.trim()) setSearchOpen(false)
                else searchInputRef.current?.focus()
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </button>
            <input
              ref={searchInputRef}
              className="dash-searchbar-input"
              value={dashSearchQuery}
              onChange={e => setDashSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { setDashSearchQuery(''); setSearchOpen(false) }
                if (e.key === 'Enter' && dashSearchQuery.trim()) submitSearch(dashSearchQuery)
              }}
              tabIndex={searchOpen ? 0 : -1}
              aria-hidden={!searchOpen}
              style={{ caretColor: dashSearchQuery ? 'var(--accent)' : 'transparent' }}
            />
            {searchOpen && !dashSearchQuery && (
              <span className="dash-search-cursor" aria-hidden="true">|</span>
            )}
          </div>
          <div className="topbar-notif-wrap" ref={notifRef}>
            <button
              className={`topbar-notif-btn${notifOpen ? ' active' : ''}`}
              aria-label="Missives"
              onClick={() => setNotifOpen(v => !v)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              {unreadCount > 0 && (
                <span className="notif-badge" aria-label={`${unreadCount} unread`}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="notif-dropdown">
                <div className="notif-dropdown-header">
                  <span className="notif-dropdown-title">Missives</span>
                  {unreadCount > 0 && (
                    <button className="notif-read-all-btn" onClick={markAllRead}>Mark all read</button>
                  )}
                </div>
                <div className="notif-list">
                  {notifications.length === 0 ? (
                    <p className="notif-empty">No missives yet.</p>
                  ) : (
                    notifications.map(n => (
                      <NotificationItem
                        key={n.id}
                        notif={n}
                        onAccept={handleAcceptInvite}
                        onDecline={handleDeclineInvite}
                      />
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="dash-layout">
        {/* ── Sidebar ── */}
        <nav className="dash-sidebar" ref={sidebarRef} aria-label="Navigation">
          <div className="sidebar-brand">
            <div className="board-icon sidebar-brand-icon">S</div>
            <span className="sidebar-brand-name">Scuffed Trello</span>
          </div>

          <div className="sidebar-profile" onClick={() => onOpenSettings('avatar')} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpenSettings('avatar') }}>
            <UserAvatar user={user} className="sidebar-profile-avatar" />
            <div className="sidebar-profile-info">
              <span className="sidebar-profile-username">{user.username}</span>
              <span className="sidebar-profile-rank">● LV.1 ADVENTURER</span>
            </div>
            <div className="sidebar-profile-stats">
              <div className="sidebar-stat">
                <span className="sidebar-stat-val">{loading ? '–' : ownedBoards.length}</span>
                <span className="sidebar-stat-label">BOARDS</span>
              </div>
              <div className="sidebar-stat-sep" />
              <div className="sidebar-stat">
                <span className="sidebar-stat-val">{loading ? '–' : sharedBoards.length}</span>
                <span className="sidebar-stat-label">SHARED</span>
              </div>
            </div>
          </div>

          <p className="sidebar-section-label">MAIN REALM</p>

          <button
            className={`sidebar-item${isPersonal ? ' active' : ''}`}
            onClick={() => { setActiveContext('personal'); setAddingBoard(false) }}
          >
            <span className="sidebar-item-icon" aria-hidden="true">⊞</span>
            <span className="sidebar-item-name">Boards</span>
          </button>

          {guilds.length > 0 && (
            <p className="sidebar-section-label">Guilds</p>
          )}

          {guilds.map(g => (
            <div key={g.id} className="sidebar-guild-row">
              <button
                className={`sidebar-item sidebar-item--guild${activeContext === g.id ? ' active' : ''}`}
                onClick={() => { setActiveContext(g.id); setAddingBoard(false) }}
              >
                <GuildIcon guild={g} className="sidebar-guild-icon" />
                <span className="sidebar-item-name">{g.name}</span>
              </button>
              {g.role === 'owner' && (
                <button
                  className="sidebar-guild-invite-btn"
                  title="Summon Allies"
                  aria-label={`Invite to ${g.name}`}
                  onClick={e => { e.stopPropagation(); setInviteTargetGuild(g); setShowGuildInvite(true) }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <line x1="19" y1="8" x2="19" y2="14"/>
                    <line x1="22" y1="11" x2="16" y2="11"/>
                  </svg>
                </button>
              )}
            </div>
          ))}

          <button
            className="sidebar-create-btn"
            onClick={() => setShowCreateGuild(true)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            Form a Guild
          </button>

          <div className="sidebar-footer">
            <button className="sidebar-footer-item" onClick={() => onOpenSettings('customization')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Settings
            </button>
            <button className="sidebar-footer-item sidebar-footer-item--logout" onClick={onLogout}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Log Out
            </button>
          </div>
        </nav>

        {/* ── Main content ── */}
        <main className="dashboard-main" ref={mainRef}>
          <section className="dash-hero-card">
            <div className="dash-hero-left">
              <p className="dash-hero-eyebrow">{today.toUpperCase()}</p>
              <h1 className="dash-hero-greeting">{greeting}, <em className="dash-hero-username">{user.username}</em>.</h1>
              <p className="dash-hero-summary">{isPersonal ? personalSummary : guildSummary}</p>
              <div className="dash-hero-actions">
                <button className="btn-hero-primary" onClick={() => { setAddingBoard(true); if (activeContext !== 'personal') {} }}>
                  Create New Board
                </button>
                <button className="btn-hero-ghost">Read Guides</button>
              </div>
            </div>
            <div className="dash-hero-preview" aria-hidden="true">
              {!loading && ownedBoards.slice(0, 4).map((b, i) => (
                <div key={b.id} className="dash-hero-mini-tile" style={{ '--tile': COLUMN_PALETTE[i % COLUMN_PALETTE.length] }}>
                  <span className="dash-hero-mini-monogram">{(b.title[0] || '?').toUpperCase()}</span>
                </div>
              ))}
              <div className="dash-hero-mini-create">+</div>
            </div>
          </section>

          {isPersonal ? (
            <>
              <div className="board-section-header">
                <h2 className="board-section-title">
                  {boardView === 'owned' ? 'My Boards' : 'Shared with me'}
                  {!loading && sharedBoards.length > 0 && (
                    <button
                      className={`board-view-toggle${viewFlipping ? ' board-view-toggle--flipping' : ''}`}
                      onClick={toggleBoardView}
                      aria-label={boardView === 'owned' ? 'Switch to shared boards' : 'Switch to my boards'}
                    >
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M1 5h10M8 2l3 3-3 3" />
                        <path d="M15 11H5M8 8l-3 3 3 3" />
                      </svg>
                      <span className="bvt-tooltip" aria-hidden="true">
                        {boardView === 'owned' ? 'Shared with me' : 'My Boards'}
                      </span>
                    </button>
                  )}
                  {!loading && (
                    <span className={`board-section-badge${boardView === 'shared' ? ' board-section-badge--teal' : ''}`}>
                      {boardView === 'owned' ? ownedBoards.length : sharedBoards.length}
                    </span>
                  )}
                </h2>
              </div>

              <section className="dashboard-section">
                {boardView === 'owned' && addingBoard && (
                  <form className="new-board-form" onSubmit={createBoard}>
                    <input
                      className="card-input"
                      placeholder="Name your board"
                      value={newTitle}
                      onChange={e => setNewTitle(e.target.value)}
                      autoFocus
                    />
                    <button className="btn-primary" type="submit">Create board</button>
                    <button className="btn-ghost" type="button" onClick={() => { setAddingBoard(false); setNewTitle('') }}>Cancel</button>
                  </form>
                )}
                <div className={`board-grid-wrap${viewFlipping ? ' board-grid-wrap--fading' : ''}`}>
                  <div className="board-grid">
                    {boardView === 'owned' ? (
                      <>
                        {!loading && !addingBoard && (
                          <button className="board-tile board-tile--create" style={{ '--stagger': 0 }} onClick={() => setAddingBoard(true)}>
                            <span className="board-tile-plus" aria-hidden="true">+</span>
                            <span className="board-tile-create-label">Embark on a Quest</span>
                          </button>
                        )}
                        {loading
                          ? Array.from({ length: skeletonOwned }).map((_, i) => <BoardTileSkeleton key={i} />)
                          : filteredOwned.map((b, i) => (
                            <BoardCard
                              key={b.id}
                              board={b}
                              index={i}
                              stagger={i + 1}
                              onOpen={onOpenBoard}
                              onDelete={deleteBoard}
                              onRename={renameBoard}
                              isOwner={true}
                            />
                          ))}
                      </>
                    ) : (
                      <>
                        {loading
                          ? Array.from({ length: skeletonShared }).map((_, i) => <BoardTileSkeleton key={i} />)
                          : filteredShared.length === 0
                            ? <p className="dashboard-empty" style={{ gridColumn: '1 / -1' }}>No shared boards match your search.</p>
                            : filteredShared.map((b, i) => (
                              <BoardCard
                                key={b.id}
                                board={b}
                                index={ownedBoards.length + i}
                                stagger={i}
                                onOpen={onOpenBoard}
                                onDelete={deleteBoard}
                                onRename={renameBoard}
                                isOwner={false}
                              />
                            ))}
                      </>
                    )}
                  </div>
                </div>
              </section>
            </>
          ) : (
            /* Guild view */
            <>
              {guildDetails && (
                <div className="guild-context-header" style={{ '--guild-color': guildHex(guildDetails.icon_color) }}>
                  <GuildIcon guild={guildDetails} className="guild-icon--lg" />
                  <div className="guild-context-info">
                    <h2 className="guild-context-name">{guildDetails.name}</h2>
                    <div className="guild-context-meta">
                      <span>{(guildDetails.members || []).length} member{(guildDetails.members || []).length !== 1 ? 's' : ''}</span>
                      <span aria-hidden="true">·</span>
                      <span>{guildBoards.length} board{guildBoards.length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  {(guildDetails.members || []).length > 0 && (
                    <div
                      className="guild-context-members"
                      aria-label={`Members: ${(guildDetails.members || []).map(m => m.username).join(', ')}`}
                    >
                      {(guildDetails.members || []).slice(0, 6).map(m => (
                        <UserAvatar key={m.id} user={m} className="guild-context-avatar" title={m.username} />
                      ))}
                      {(guildDetails.members || []).length > 6 && (
                        <span className="guild-context-avatar guild-context-avatar--more">
                          +{(guildDetails.members || []).length - 6}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="guild-context-actions">
                    {guildDetails.owner_id === user.id && (
                      <button
                        className="guild-invite-trigger-btn"
                        onClick={() => { setInviteTargetGuild(guildDetails); setShowGuildInvite(true) }}
                        title="Summon Allies"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                          <circle cx="9" cy="7" r="4"/>
                          <line x1="19" y1="8" x2="19" y2="14"/>
                          <line x1="22" y1="11" x2="16" y2="11"/>
                        </svg>
                        Summon Allies
                      </button>
                    )}
                    <button
                      className="board-tile-btn guild-manage-btn"
                      onClick={() => setShowGuildSettings(true)}
                      title="Manage guild"
                    >
                      ⚙
                    </button>
                  </div>
                </div>
              )}

              <section className="dashboard-section">
                {addingBoard && (
                  <form className="new-board-form" onSubmit={createBoard}>
                    <input
                      className="card-input"
                      placeholder="Name your quest board"
                      value={newTitle}
                      onChange={e => setNewTitle(e.target.value)}
                      autoFocus
                    />
                    <button className="btn-primary" type="submit">Create board</button>
                    <button className="btn-ghost" type="button" onClick={() => { setAddingBoard(false); setNewTitle('') }}>Cancel</button>
                  </form>
                )}
                <div className="board-grid">
                  {!addingBoard && (
                    <button className="board-tile board-tile--create" style={{ '--stagger': 0 }} onClick={() => setAddingBoard(true)}>
                      <span className="board-tile-plus" aria-hidden="true">+</span>
                      <span className="board-tile-create-label">Add a Quest</span>
                    </button>
                  )}
                  {guildBoardsLoading
                    ? Array.from({ length: 3 }).map((_, i) => <BoardTileSkeleton key={i} />)
                    : guildBoards.map((b, i) => (
                      <BoardCard
                        key={b.id}
                        board={b}
                        index={i}
                        stagger={i + 1}
                        onOpen={onOpenBoard}
                        onDelete={deleteGuildBoard}
                        onRename={renameGuildBoard}
                        isOwner={b.role === 'owner'}
                      />
                    ))}
                  {!guildBoardsLoading && guildBoards.length === 0 && (
                    <p className="dashboard-empty" style={{ gridColumn: '1 / -1' }}>
                      No quest boards yet — add the first one for your guild.
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
          {isPersonal && recentSearches.length > 0 && (
            <section className="dash-recent-search">
              <h2 className="dash-section-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                Recent Search
              </h2>
              <div className="dash-recent-chips">
                {recentSearches.map(s => (
                  <button
                    key={s}
                    className="dash-search-chip"
                    onClick={() => setDashSearchQuery(s)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    {s}
                  </button>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>

      {showGuildInvite && inviteTargetGuild && (
        <GuildInviteModal
          guild={inviteTargetGuild}
          onClose={() => { setShowGuildInvite(false); setInviteTargetGuild(null) }}
        />
      )}

      {showCreateGuild && (
        <CreateGuildModal
          onClose={() => setShowCreateGuild(false)}
          onCreate={guild => setGuilds(gs => [...gs, guild])}
        />
      )}

      {showGuildSettings && guildDetails && (
        <GuildSettingsModal
          guild={{ ...guildDetails, board_count: guildBoards.length }}
          currentUserId={user.id}
          onClose={() => setShowGuildSettings(false)}
          onUpdate={updated => {
            setGuildDetails(prev => ({ ...prev, ...updated }))
            setGuilds(gs => gs.map(g => g.id === updated.id ? { ...g, name: updated.name, icon_color: updated.icon_color } : g))
          }}
          onDelete={id => {
            setGuilds(gs => gs.filter(g => g.id !== id))
            setActiveContext('personal')
          }}
          onMemberAdd={member => setGuildDetails(prev => ({ ...prev, members: [...(prev.members || []), member] }))}
          onMemberRemove={userId => setGuildDetails(prev => ({ ...prev, members: (prev.members || []).filter(m => m.id !== userId) }))}
        />
      )}
    </div>
  )
}
