import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { gsap } from 'gsap'
import { apiFetch, assetUrl } from '../api.js'
import { relativeTime } from '../utils.js'
import { COLUMN_PALETTE, ZODIAC_CONSTELLATIONS } from '../constants.js'
import UserAvatar from '../components/UserAvatar.jsx'
import Starfield from '../components/Starfield.jsx'
import NebulaVeil from '../components/NebulaVeil.jsx'

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
      <div className="card-modal guild-modal" role="dialog" aria-modal="true" aria-label="Forge an Alliance">
        <div className="card-modal-header">
          <h2 className="guild-modal-title">Forge an Alliance</h2>
        </div>
        <div className="card-modal-body">
          <form onSubmit={handleSubmit} className="guild-modal-form">
            <div>
              <label className="guild-field-label">Alliance Name</label>
              <input
                className="card-input"
                placeholder="e.g. Star Watchers"
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
              <span className="guild-preview-name">{name || 'Unnamed Alliance'}</span>
            </div>
            {error && <p className="auth-error">{error}</p>}
            <div className="guild-modal-actions">
              <button className="btn-primary" type="submit" disabled={busy || !name.trim()}>
                {busy ? 'Forging…' : 'Forge Alliance'}
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
      <p className="board-popover-label">Rename galaxy</p>
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
          <span className="board-popover-confirm-msg">Delete this galaxy?</span>
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
  // stable per board (not grid position) so a board keeps its sign across reorders
  const zodiac = ZODIAC_CONSTELLATIONS[board.id % ZODIAC_CONSTELLATIONS.length]

  // Sparkle timing: hand each star an evenly-spaced slot across the 8s cycle,
  // then shuffle the slots (seeded by board id) so the flares fire scattered in
  // time — never all at once, at most ~2 overlapping — but not left-to-right.
  const sparkleDelays = useMemo(() => {
    const n = zodiac.points.length
    const CYCLE = 8
    const slots = Array.from({ length: n }, (_, i) => +((i / n) * CYCLE).toFixed(2))
    let seed = (board.id * 1103515245 + 12345) & 0x7fffffff
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      ;[slots[i], slots[j]] = [slots[j], slots[i]]
    }
    return slots
  }, [board.id, zodiac])

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
  function closePreview() {
    clearTimeout(hoverTimer.current)
    setPreviewOpen(false)
  }

  return (
    <div
      className="board-tile"
      style={{ '--tile': color, '--stagger': stagger }}
      onClick={() => !showSettings && onOpen(board.id, color)}
      onMouseEnter={openPreview}
      onMouseLeave={closePreview}
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
        <svg className="board-tile-zodiac" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline
            className="board-tile-zodiac-line"
            points={zodiac.points.map(([x, y]) => `${x},${y}`).join(' ')}
          />
          {/* soft blurred halo behind each node — the luminous aura */}
          {zodiac.points.map(([x, y], i) => (
            <circle
              key={`halo-${i}`}
              className="board-tile-zodiac-halo"
              cx={x}
              cy={y}
              r={i % 3 === 0 ? 5 : 4}
              style={{ animationDelay: `${(sparkleDelays[i] % 3.2).toFixed(2)}s` }}
            />
          ))}
          {zodiac.points.map(([x, y], i) => (
            <circle
              key={i}
              className="board-tile-zodiac-star"
              cx={x}
              cy={y}
              r={i % 3 === 0 ? 1.8 : 1.2}
              style={{
                // twinkle phase derived from the same slot so stars don't pulse in unison
                animationDelay: `${(sparkleDelays[i] % 3.2).toFixed(2)}s, ${sparkleDelays[i]}s`,
              }}
            />
          ))}
        </svg>
      </div>

      <div className="board-tile-top">
        {!isOwner && <span className="board-tile-tag">Shared</span>}
        {isOwner && (
          <div className="board-tile-actions" onClick={e => e.stopPropagation()}>
            <button
              className={`board-tile-btn${showSettings ? ' active' : ''}`}
              title="Galaxy settings"
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
        </div>
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

// ── Cosmic Activity: small line icon per event kind ──
const ACTIVITY_ICONS = {
  card: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 13h6" />
    </svg>
  ),
  board: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </svg>
  ),
  guild: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4-3 7-7 9-4-2-7-5-7-9V6z" />
    </svg>
  ),
  rename: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  delete: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" />
    </svg>
  ),
}

// Pick the glyph for a feed row. Board renames/deletes get their own icon so the
// action reads at a glance; everything else falls back to its kind's icon.
function activityIcon(a) {
  if (a.kind === 'board' && a.action === 'renamed') return ACTIVITY_ICONS.rename
  if (a.kind === 'board' && a.action === 'deleted') return ACTIVITY_ICONS.delete
  return ACTIVITY_ICONS[a.kind] || ACTIVITY_ICONS.card
}

// Turns a feed row into a human "recent discovery" sentence.
function activityText(a) {
  const title = <strong>{a.title || 'an item'}</strong>
  switch (`${a.kind}:${a.action}`) {
    case 'card:created':  return <>Added {title}{a.context && <> to {a.context}</>}</>
    case 'card:edited':   return <>Updated {title}{a.context && <> in {a.context}</>}</>
    case 'card:moved':    return <>Moved {title}{a.context && <> within {a.context}</>}</>
    case 'card:deleted':  return <>Removed {title}{a.context && <> from {a.context}</>}</>
    case 'board:created': return <>Charted a new galaxy, {title}</>
    case 'board:renamed': return <>Renamed the galaxy <strong>{a.context}</strong> to {title}</>
    case 'board:deleted': return <>Collapsed the galaxy {title}</>
    case 'guild:founded': return <>Founded the guild {title}</>
    case 'guild:joined':  return <>Joined the guild {title}</>
    default:              return title
  }
}

export default function Dashboard({ user, onOpenBoard, onLogout, onOpenSettings }) {
  const rootRef = useRef(null)
  const sidebarRef = useRef(null)
  const mainRef = useRef(null)
  const searchRef = useRef(null)
  const searchInputRef = useRef(null)
  const notifRef = useRef(null)
  const streakRef = useRef(null)
  const activityPageRef = useRef(null)
  const feedListRef = useRef(null)
  const scrollThumbRef = useRef(null)
  // hero ringed planet — rides through both skies; only the sky tone changes
  const heroPlanetRef = useRef(null)
  const heroGlowRef = useRef(null)  // breathing aura behind the planet
  const heroSunRef = useRef(null)   // retired sun body, kept hidden in both modes
  const heroRaysRef = useRef(null)
  const modeIconRef = useRef(null)
  const modeFxRef = useRef(null)    // full-screen wipe overlay for mode switches
  const heroBodyInit = useRef(false) // skip the settle animation on first paint

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
  const [activity, setActivity] = useState([])
  const [activityLoading, setActivityLoading] = useState(true)
  const [activityPageOpen, setActivityPageOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [notifOpen, setNotifOpen] = useState(false)
  const [showGuildInvite, setShowGuildInvite] = useState(false)
  const [inviteTargetGuild, setInviteTargetGuild] = useState(null)

  // Day/Night dashboard mode — defaults to night (the original design).
  const [colorMode, setColorMode] = useState(() => localStorage.getItem('dash-color-mode') || 'night')
  function applyColorMode(next) {
    localStorage.setItem('dash-color-mode', next)
    setColorMode(next)
  }
  function toggleColorMode() {
    const next = colorMode === 'night' ? 'day' : 'night'

    // little GSAP pop on the toggle glyph
    if (modeIconRef.current) {
      gsap.fromTo(modeIconRef.current,
        { rotate: -90, scale: 0.4, opacity: 0 },
        { rotate: 0, scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(2)' })
    }

    const fx = modeFxRef.current
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!fx || reduced) { applyColorMode(next); return }

    // gentle cross-fade: a veil in the incoming sky's tone fades in, we swap the
    // theme underneath while it's opaque, then it fades back out to reveal it
    fx.style.background = next === 'day' ? '#ccd4e0' : '#06070b'
    gsap.timeline()
      .set(fx, { autoAlpha: 0 })
      .to(fx, { autoAlpha: 1, duration: 0.26, ease: 'power1.inOut' })
      .add(() => applyColorMode(next))
      .to(fx, { autoAlpha: 0, duration: 0.34, ease: 'power1.inOut' })
  }

  function toggleBoardView() {
    if (viewFlipping) return
    setViewFlipping(true)
    setTimeout(() => setBoardView(v => v === 'owned' ? 'shared' : 'owned'), 150)
    setTimeout(() => setViewFlipping(false), 300)
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

  // Cosmic Activity feed — the user's own recent deeds. Re-fetched on mount,
  // whenever the tab regains focus (e.g. returning from a board), and after
  // actions on the dashboard that produce new activity (see createBoard).
  const loadActivity = useCallback(() => {
    return apiFetch('/api/me/activity')
      .then(r => r.ok ? r.json() : [])
      .then(data => setActivity(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setActivityLoading(false))
  }, [])

  useEffect(() => {
    loadActivity()
    const refresh = () => { if (!document.hidden) loadActivity() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [loadActivity])

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

  // ── GSAP entrance: hero copy + sidebar drift in on mount ──
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = gsap.context(() => {
      gsap.from('.dash-hero-eyebrow, .dash-hero-greeting, .dash-hero-summary', {
        y: 20, opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.09, delay: 0.08,
      })
      gsap.from('.dash-sidebar .sidebar-profile, .dash-sidebar .sidebar-section-label, .dash-sidebar .sidebar-item, .dash-sidebar .sidebar-create-btn', {
        x: -18, opacity: 0, duration: 0.5, ease: 'power2.out', stagger: 0.035, delay: 0.05,
      })
      // hero orrery drifts in, then breathes with a slow vertical float
      gsap.from('.dash-hero-art', { scale: 0.8, opacity: 0, duration: 0.9, ease: 'power3.out', delay: 0.2 })
      gsap.to('.dash-hero-art-svg', { y: -7, duration: 3.4, repeat: -1, yoyo: true, ease: 'sine.inOut' })
      // the streak/activity chip in the hero
      gsap.from('.hero-stats-trigger', { y: 14, opacity: 0, duration: 0.6, ease: 'power3.out', delay: 0.34 })
    }, rootRef)
    return () => ctx.revert()
  }, [])

  // ── GSAP: the ringed planet rides through both skies — only the sky tone
  //    cross-fades between day and night (see toggleColorMode's wipe). The sun
  //    body stays retired; on a mode switch the planet gives a soft settle. ──
  useEffect(() => {
    const planet = heroPlanetRef.current
    const sun = heroSunRef.current
    if (!planet || !sun) return
    gsap.set(sun, { autoAlpha: 0 })

    if (!heroBodyInit.current) {
      gsap.set(planet, { autoAlpha: 1, scale: 1.1, svgOrigin: '100 100' })
      heroBodyInit.current = true
    } else if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.fromTo(planet,
        { scale: 0.95, svgOrigin: '100 100' },
        { scale: 1.1, autoAlpha: 1, duration: 0.6, ease: 'back.out(1.7)', overwrite: 'auto' })
    }
  }, [colorMode])

  // The planet's aura now breathes via a pure-CSS keyframe pulse
  // (.hero-glow-core in App.css) rather than GSAP, so it honors
  // prefers-reduced-motion and never touches layout.

  // ── GSAP reveal: board tiles rise + constellation lines stroke-draw ──
  useEffect(() => {
    if (loading || guildBoardsLoading) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = gsap.context(() => {
      gsap.from('.board-grid > *', {
        y: 26, opacity: 0, scale: 0.97, duration: 0.55, ease: 'power3.out', stagger: 0.06,
        clearProps: 'transform,opacity', // end in pure CSS state — no inline residue that distorts size or blocks :hover
      })
      rootRef.current?.querySelectorAll('.board-tile-zodiac-line').forEach(line => {
        const len = line.getTotalLength?.()
        if (!len) return
        gsap.fromTo(line,
          { strokeDasharray: len, strokeDashoffset: len },
          { strokeDashoffset: 0, duration: 1.2, ease: 'power2.out', delay: 0.25, clearProps: 'strokeDasharray,strokeDashoffset' })
      })
    }, rootRef)
    return () => ctx.revert()
  }, [loading, guildBoardsLoading, boardView, activeContext])

  // ── GSAP: animate the Cosmic Activity page open (backdrop, panel, streak, rows) ──
  useEffect(() => {
    if (!activityPageOpen) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = gsap.context(() => {
      if (activityPageRef.current) gsap.from(activityPageRef.current, { opacity: 0, duration: 0.25, ease: 'power1.out' })
      gsap.from('.cosmic-page', { y: 34, scale: 0.96, opacity: 0, duration: 0.5, ease: 'power3.out' })
      gsap.from('.cosmic-page .streak-flame', { scale: 0.5, opacity: 0, duration: 0.6, ease: 'back.out(1.7)', delay: 0.18 })
      // pop the dots in with a fromTo so they always settle visible — a plain
      // from(scale:0) can leave them stuck invisible if the open tween is cut short
      gsap.fromTo('.cosmic-page .streak-dot',
        { scale: 0, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(2)', stagger: 0.05, delay: 0.34, clearProps: 'transform,opacity' })
      // Voyager's Log slides in, and the milestone bar grows from empty
      gsap.from('.cosmic-page .streak-extras > *', { y: 14, opacity: 0, duration: 0.5, ease: 'power2.out', stagger: 0.08, delay: 0.46 })
      gsap.from('.cosmic-page .streak-milestone-fill', { scaleX: 0, transformOrigin: 'left center', duration: 0.9, ease: 'power2.out', delay: 0.62 })

      // count the streak number up from zero
      const target = user.streak_count ?? 0
      if (streakRef.current) {
        streakRef.current.textContent = '0'
        const proxy = { n: 0 }
        gsap.to(proxy, {
          n: target, duration: 1, delay: 0.25, ease: 'power2.out',
          onUpdate: () => { if (streakRef.current) streakRef.current.textContent = String(Math.round(proxy.n)) },
        })
      }
    }, activityPageRef)
    return () => ctx.revert()
  }, [activityPageOpen])

  // Stagger the feed rows in. Keyed on the row count as well as open-state so
  // entries that arrive from the async refresh *after* the page opens (e.g. a
  // just-performed board rename/delete) still animate in rather than popping
  // into place — the row animation lives here rather than in the panel effect
  // above so it can re-fire without re-triggering the panel/streak entrance.
  useEffect(() => {
    if (!activityPageOpen || activity.length === 0) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = gsap.context(() => {
      gsap.from('.cosmic-page .cosmic-activity-item', {
        x: -16, opacity: 0, duration: 0.45, ease: 'power2.out', stagger: 0.06, delay: 0.2,
      })
    }, activityPageRef)
    return () => ctx.revert()
  }, [activityPageOpen, activity.length])

  // Close the Cosmic Activity page on Escape; refresh its data each time it opens.
  useEffect(() => {
    if (!activityPageOpen) return
    loadActivity()
    function onKey(e) { if (e.key === 'Escape') setActivityPageOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [activityPageOpen, loadActivity])

  // Custom overlay scrollbar for the activity feed: hidden at rest, GSAP-fades
  // in only while scrolling, then fades out once the user stops.
  useEffect(() => {
    if (!activityPageOpen) return
    const list = feedListRef.current
    const thumb = scrollThumbRef.current
    if (!list || !thumb) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let idle

    const sizeThumb = () => {
      const { scrollHeight, clientHeight, scrollTop } = list
      if (scrollHeight <= clientHeight + 1) { thumb.style.height = '0'; return false }
      const h = Math.max(28, (clientHeight / scrollHeight) * clientHeight)
      const top = (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - h)
      thumb.style.height = `${h}px`
      thumb.style.transform = `translateY(${top}px)`
      return true
    }

    const onScroll = () => {
      if (!sizeThumb()) return
      if (reduced) {
        thumb.style.opacity = '0.55'
        clearTimeout(idle)
        idle = setTimeout(() => { thumb.style.opacity = '0' }, 700)
        return
      }
      gsap.to(thumb, { opacity: 1, duration: 0.18, ease: 'power1.out', overwrite: true })
      clearTimeout(idle)
      idle = setTimeout(() => gsap.to(thumb, { opacity: 0, duration: 0.5, ease: 'power1.out' }), 700)
    }

    sizeThumb() // position it correctly while still invisible
    list.addEventListener('scroll', onScroll, { passive: true })
    return () => { list.removeEventListener('scroll', onScroll); clearTimeout(idle) }
  }, [activityPageOpen, activity.length])

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
    loadActivity() // surface the new board in Cosmic Activity immediately
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

  // ── Voyager's Log: streak milestone + cosmic rank for the activity panel ──
  const streakNow = user.streak_count ?? 0
  const bestStreak = Math.max(streakNow, user.longest_streak ?? 0)
  const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 365]
  const nextMilestone = STREAK_MILESTONES.find(m => m > streakNow) ?? null
  const milestonePct = nextMilestone ? Math.min(100, Math.round((streakNow / nextMilestone) * 100)) : 100
  const milestoneToGo = nextMilestone ? nextMilestone - streakNow : 0
  const cosmicRank =
    bestStreak >= 30 ? 'Galactic Voyager' :
    bestStreak >= 14 ? 'Constellation Keeper' :
    bestStreak >= 7  ? 'Starfarer' :
    bestStreak >= 4  ? 'Nebula Navigator' :
    bestStreak >= 2  ? 'Comet Rider' :
                       'Stardust Drifter'

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

  // one Cosmic Activity row — shared by the 3-row preview and the "View all" panel
  const renderActivityRow = (a, i) => (
    <li key={i} className="cosmic-activity-item">
      <span className={`cosmic-activity-icon cosmic-activity-icon--${a.kind}${a.kind === 'board' && a.action === 'deleted' ? ' cosmic-activity-icon--deleted' : ''}`}>
        {activityIcon(a)}
      </span>
      <span className="cosmic-activity-text">{activityText(a)}</span>
      <span className="cosmic-activity-time">{relativeTime(a.created_at)}</span>
    </li>
  )

  const personalSummary = loading
    ? 'Charting your galaxies…'
    : ownedBoards.length === 0 && sharedBoards.length === 0
      ? 'No galaxies yet — chart your first to begin your voyage.'
      : <>
          {`${ownedBoards.length} galax${ownedBoards.length === 1 ? 'y' : 'ies'}`}
          {sharedBoards.length ? ` · ${sharedBoards.length} shared with you` : ''}
          {' · '}<em className="dash-hero-cta">choose your journey.</em>
        </>

  const guildSummary = guildDetails
    ? `${guildBoards.length} board${guildBoards.length !== 1 ? 's' : ''} · ${(guildDetails.members || []).length} member${(guildDetails.members || []).length !== 1 ? 's' : ''} · your guild's shared quests.`
    : 'Loading guild…'

  const isPersonal = activeContext === 'personal'

  return (
    <div className={`dashboard-shell${colorMode === 'day' ? ' dashboard-shell--day' : ''}`} ref={rootRef}>
      {colorMode === 'day' && <NebulaVeil />}
      <Starfield mode={colorMode} />
      <span className="mode-fx" ref={modeFxRef} aria-hidden="true" />

      <header className="topbar">
        <div className="topbar-left">
          <p className="topbar-breadcrumb">DASHBOARD › {isPersonal ? 'MY BOARDS' : (guildDetails?.name?.toUpperCase() || 'GUILD')}</p>
          <h1 className="topbar-page-title">{isPersonal ? 'My Universe' : (guildDetails?.name || 'Guild')}</h1>
        </div>
        <div className="topbar-right">
          <button
            className="dash-mode-toggle"
            onClick={toggleColorMode}
            aria-label={colorMode === 'day' ? 'Switch to night mode' : 'Switch to day mode'}
            title={colorMode === 'day' ? 'Night mode' : 'Day mode'}
          >
            <span className="dash-mode-toggle-icon" ref={modeIconRef}>
              {colorMode === 'day' ? (
                // currently day → offer the moon
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              ) : (
                // currently night → offer the sun
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              )}
            </span>
          </button>
          <div
            className={`dash-searchbar-wrap${searchOpen ? ' open' : ''}`}
            ref={searchRef}
          >
            <button
              className="dash-search-icon-btn"
              aria-label="Search galaxies"
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
          <div className="sidebar-profile" onClick={() => onOpenSettings('avatar')} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpenSettings('avatar') }}>
            <UserAvatar user={user} className="sidebar-profile-avatar" />
            <div className="sidebar-profile-info">
              <span className="sidebar-profile-username">{user.username}</span>
              <span className="sidebar-profile-rank">{cosmicRank}</span>
            </div>
          </div>

          <p className="sidebar-section-label">HOME SYSTEM</p>

          <button
            className={`sidebar-item${isPersonal && boardView === 'owned' ? ' active' : ''}`}
            onClick={() => { setActiveContext('personal'); setBoardView('owned'); setAddingBoard(false) }}
          >
            <span className="sidebar-item-icon" aria-hidden="true">⊞</span>
            <span className="sidebar-item-name">Galaxies</span>
          </button>

          <button
            className={`sidebar-item${isPersonal && boardView === 'shared' ? ' active' : ''}`}
            onClick={() => { setActiveContext('personal'); setBoardView('shared'); setAddingBoard(false) }}
          >
            <span className="sidebar-item-icon" aria-hidden="true">⇄</span>
            <span className="sidebar-item-name">Shared Universe</span>
            {sharedBoards.length > 0 && <span className="sidebar-item-count">{sharedBoards.length}</span>}
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
              {g.role === 'owner' && (
                <button
                  className="sidebar-guild-manage-btn"
                  title="Manage / Disband"
                  aria-label={`Manage ${g.name}`}
                  onClick={e => { e.stopPropagation(); setActiveContext(g.id); setShowGuildSettings(true) }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
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
            Forge an Alliance
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
            {/* celestial filigree anchored to the top-left corner */}
            <svg className="dash-hero-corner" viewBox="0 0 150 150" fill="none" aria-hidden="true">
              {/* double L-bracket framing the corner */}
              <path className="dhc-line" d="M24 92 L24 32 Q24 24 32 24 L92 24" />
              <path className="dhc-line dhc-line--faint" d="M36 100 L36 42 Q36 36 42 36 L100 36" />
              {/* faint orbit arc */}
              <path className="dhc-arc" d="M104 28 A76 76 0 0 0 28 104" />
              {/* radiant compass star at the vertex */}
              <path className="dhc-star dhc-star--lg" d="M24 4 L26.4 21.6 L44 24 L26.4 26.4 L24 44 L21.6 26.4 L4 24 L21.6 21.6 Z" />
              {/* scattered stars */}
              <path className="dhc-star" d="M68 14 L69 18 L73 19 L69 20 L68 24 L67 20 L63 19 L67 18 Z" />
              <path className="dhc-star" d="M14 68 L15 72 L19 73 L15 74 L14 78 L13 74 L9 73 L13 72 Z" />
              <circle className="dhc-dot" cx="58" cy="50" r="1.2" />
              <circle className="dhc-dot" cx="100" cy="62" r="1.4" />
              <circle className="dhc-dot" cx="50" cy="100" r="1.2" />
            </svg>
            {/* diamond stars scattered across the banner for depth & texture */}
            {[
              { cls: 'hero-card-star--md', pos: { top: '62%', left: '3%' } },     // bottom-left of the summary line
              { cls: 'hero-card-star--sm', pos: { top: '8%', left: '13%' } },     // near the top border, left side
              { cls: 'hero-card-star--sm', pos: { top: '47%', left: '6.5%' } },   // directly below the greeting name
              { cls: 'hero-card-star--sm', pos: { top: '85%', left: '20%' } },    // below "Cosmic Activity"
              { cls: 'hero-card-star--md', pos: { top: '9%', right: '3%' } },     // upper-right corner
              // cluster plastered in the open band right of the name / summary
              { cls: 'hero-card-star--md', pos: { top: '36%', left: '57%' } },    // top (nudged right)
              { cls: 'hero-card-star--lg', pos: { top: '86%', left: '70%' } },    // bottom-right, kept clear of the Saturn orrery
              { cls: 'hero-card-star--md', pos: { top: '70%', left: '31%' } },    // below — next to Cosmic Activity
            ].map((s, i) => (
              <svg key={i} className={`hero-card-star ${s.cls}`} style={s.pos} viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 0 L13.6 10.4 L24 12 L13.6 13.6 L12 24 L10.4 13.6 L0 12 L10.4 10.4 Z" />
              </svg>
            ))}
            <div className="dash-hero-left">
              <p className="dash-hero-eyebrow">{today.toUpperCase()}</p>
              <h1 className="dash-hero-greeting">{greeting}, <em className="dash-hero-username">{user.username}</em>.</h1>
              <p className="dash-hero-summary">{isPersonal ? personalSummary : guildSummary}</p>

              <button
                type="button"
                className="hero-stats-trigger"
                onClick={() => setActivityPageOpen(true)}
                aria-haspopup="dialog"
              >
                <span className="hero-stat-streak">
                  <svg className="hero-stat-flame" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 2c1 3-1 4-2 6-1.4 2.8.4 4.8 2 4.8 1.2 0 2.1-1 1.9-2.4 1.6 1 2.6 2.7 2.6 4.4A6.4 6.4 0 0 1 5.6 15c0-3 1.9-4.6 3-7 .8-1.9 2.4-3.9 3.4-6z" />
                  </svg>
                  <strong>{user.streak_count ?? 0}</strong> day{(user.streak_count ?? 0) === 1 ? '' : 's'} active
                </span>
                <span className="hero-stat-sep" aria-hidden="true">·</span>
                <span className="hero-stat-link">
                  Cosmic Activity
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </span>
              </button>
            </div>
            <div className="dash-hero-art" aria-hidden="true">
              <svg className="dash-hero-art-svg" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <radialGradient id="heroPlanet" cx="38%" cy="32%" r="78%">
                    <stop offset="0%" stopColor="#f1f4fa" />
                    <stop offset="52%" stopColor="#aab2c6" />
                    <stop offset="100%" stopColor="#363c4a" />
                  </radialGradient>
                  {/* daylight: a deep, saturated navy sphere fading to near-black */}
                  <radialGradient id="heroPlanetDay" cx="38%" cy="32%" r="80%">
                    <stop offset="0%" stopColor="#46587e" />
                    <stop offset="48%" stopColor="#222c44" />
                    <stop offset="100%" stopColor="#0a0e1a" />
                  </radialGradient>
                  <radialGradient id="heroGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="rgba(198,208,230,0.45)" />
                    <stop offset="100%" stopColor="rgba(198,208,230,0)" />
                  </radialGradient>
                  {/* daylight: a soft dark-blue aura/halo so the navy planet has depth */}
                  <radialGradient id="heroGlowDay" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="rgba(34,52,102,0.5)" />
                    <stop offset="55%" stopColor="rgba(26,40,82,0.24)" />
                    <stop offset="100%" stopColor="rgba(26,40,82,0)" />
                  </radialGradient>
                  <radialGradient id="heroSun" cx="42%" cy="38%" r="72%">
                    <stop offset="0%" stopColor="#fff3d0" />
                    <stop offset="52%" stopColor="#ffb43c" />
                    <stop offset="100%" stopColor="#e07a1a" />
                  </radialGradient>
                  <radialGradient id="heroSunGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="rgba(255,190,90,0.55)" />
                    <stop offset="100%" stopColor="rgba(255,190,90,0)" />
                  </radialGradient>
                  {/* surface latitude lines: light gray fading to dark gray */}
                  <linearGradient id="heroBandLight" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#eef1f6" />
                    <stop offset="50%" stopColor="#9aa0ad" />
                    <stop offset="100%" stopColor="#3c414c" />
                  </linearGradient>
                  {/* the four-pointed compass star, normalized to the origin so it can be
                      scattered at any size/position via <use transform> */}
                  <path id="heroStarShape" d="M0,-13 L1.6,-1.6 L13,0 L1.6,1.6 L0,13 L-1.6,1.6 L-13,0 L-1.6,-1.6 Z" />
                </defs>

                {/* zodiac wheel */}
                <circle className="hero-wheel" cx="100" cy="100" r="90" />
                <g className="hero-wheel-ticks">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <line
                      key={i}
                      x1="100" y1="6" x2="100" y2="14"
                      transform={`rotate(${i * 30} 100 100)`}
                    />
                  ))}
                </g>

                {/* central glow — pulses via GSAP so the planet breathes light */}
                <circle className="hero-glow-core" ref={heroGlowRef} cx="100" cy="100" r="50" fill="url(#heroGlow)" />

                {/* the tilted ringed planet (saturn) — shown in both day and night */}
                <g className="hero-planet-group" ref={heroPlanetRef} style={{ visibility: 'visible' }}>
                  <g transform="rotate(-18 100 100)">
                    <ellipse className="hero-ring hero-ring--back" cx="100" cy="100" rx="42" ry="13" />
                    <circle className="hero-planet-body" cx="100" cy="100" r="21" fill="url(#heroPlanet)" />
                    {/* two latitude lines meeting the planet's edge so they read as curving over the sphere, sitting just above the front ring */}
                    <path className="hero-band-light" d="M79,98 q21,7 42,-3" />
                    <path className="hero-band-light" d="M80,104 q20,7 40,-3" />
                    <path className="hero-ring hero-ring--front" d="M58,100 a42,13 0 0 0 84,0" />
                  </g>
                </g>

                {/* retired sun body — kept in the DOM but hidden in both modes */}
                <g className="hero-sun-group" ref={heroSunRef} style={{ visibility: 'hidden' }}>
                  <circle className="hero-sun-glow" cx="100" cy="100" r="50" fill="url(#heroSunGlow)" />
                  <g className="hero-rays" ref={heroRaysRef}>
                    {Array.from({ length: 12 }).map((_, i) => (
                      <line key={i} className="hero-ray" x1="100" y1="68" x2="100" y2="56" transform={`rotate(${i * 30} 100 100)`} />
                    ))}
                  </g>
                  <circle className="hero-sun" cx="100" cy="100" r="22" fill="url(#heroSun)" />
                </g>

                {/* orbiting moons */}
                <g className="hero-orbit hero-orbit--a">
                  <circle className="hero-orbit-path" cx="100" cy="100" r="80" />
                  <circle className="hero-moon" cx="100" cy="20" r="3.4" />
                </g>
                <g className="hero-orbit hero-orbit--b">
                  <circle className="hero-orbit-path" cx="100" cy="100" r="62" />
                  <circle className="hero-moon hero-moon--sm" cx="100" cy="38" r="2.4" />
                </g>

                {/* ambient sparkles scattered to the corners */}
                <path className="hero-spark hero-spark--1" d="M34,52 l1.4,4 4,1.4 -4,1.4 -1.4,4 -1.4,-4 -4,-1.4 4,-1.4 z" />
                <path className="hero-spark hero-spark--2" d="M168,140 l1.1,3.2 3.2,1.1 -3.2,1.1 -1.1,3.2 -1.1,-3.2 -3.2,-1.1 3.2,-1.1 z" />
                <path className="hero-spark hero-spark--3" d="M150,38 l0.9,2.6 2.6,0.9 -2.6,0.9 -0.9,2.6 -0.9,-2.6 -2.6,-0.9 2.6,-0.9 z" />
                {/* two echo stars nudged outward so their centres rest on the outer orbit
                    ring (r=80) — top-right + bottom-left */}
                <path className="hero-star hero-star--c" transform="translate(2.5,-2)" d="M160,44 L161,51 L168,52 L161,53 L160,60 L159,53 L152,52 L159,51 Z" />
                <path className="hero-star hero-star--d" transform="translate(-3.7,3.3)" d="M44,142 L45,149 L52,150 L45,151 L44,158 L43,151 L36,150 L43,149 Z" />
                {/* scattered star dust — small & medium echoes of the compass star spread
                    across the card to add depth and texture */}
                <use href="#heroStarShape" className="hero-star hero-star--md" transform="translate(34,80) scale(0.46)" />
                <use href="#heroStarShape" className="hero-star hero-star--md" transform="translate(168,116) scale(0.42)" />
                <use href="#heroStarShape" className="hero-star hero-star--md" transform="translate(98,176) scale(0.4)" />
                <use href="#heroStarShape" className="hero-star hero-star--sm" transform="translate(22,34) scale(0.22)" />
                <use href="#heroStarShape" className="hero-star hero-star--sm" transform="translate(181,30) scale(0.2)" />
                <use href="#heroStarShape" className="hero-star hero-star--sm" transform="translate(16,126) scale(0.24)" />
                <use href="#heroStarShape" className="hero-star hero-star--sm" transform="translate(186,152) scale(0.2)" />
                <use href="#heroStarShape" className="hero-star hero-star--sm" transform="translate(118,18) scale(0.22)" />
                <use href="#heroStarShape" className="hero-star hero-star--sm" transform="translate(78,160) scale(0.18)" />
                <use href="#heroStarShape" className="hero-star hero-star--sm" transform="translate(150,168) scale(0.22)" />
              </svg>
            </div>
          </section>

          {isPersonal ? (
            <>
              <div className="board-section-header">
                <h2 className="board-section-title">
                  {boardView === 'owned' ? 'My Universe' : 'Shared Universe'}
                  {!loading && sharedBoards.length > 0 && (
                    <button
                      className={`board-view-toggle${viewFlipping ? ' board-view-toggle--flipping' : ''}`}
                      onClick={toggleBoardView}
                      aria-label={boardView === 'owned' ? 'Switch to shared universe' : 'Switch to my universe'}
                    >
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M1 5h10M8 2l3 3-3 3" />
                        <path d="M15 11H5M8 8l-3 3 3 3" />
                      </svg>
                      <span className="bvt-tooltip" aria-hidden="true">
                        {boardView === 'owned' ? 'Shared Universe' : 'My Universe'}
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
                      placeholder="Name your galaxy"
                      value={newTitle}
                      onChange={e => setNewTitle(e.target.value)}
                      autoFocus
                    />
                    <button className="btn-primary" type="submit">Chart Galaxy</button>
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
                            <span className="board-tile-create-label">Chart New Galaxy</span>
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
                            ? <p className="dashboard-empty" style={{ gridColumn: '1 / -1' }}>No shared universe matches your search.</p>
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
        </main>
      </div>

      {/* ── Cosmic Activity page (full overlay, opened from the hero) ── */}
      {activityPageOpen && (
        <div
          className="cosmic-page-overlay"
          ref={activityPageRef}
          onClick={e => { if (e.target === e.currentTarget) setActivityPageOpen(false) }}
        >
          <div className="cosmic-page" role="dialog" aria-modal="true" aria-label="Cosmic Activity">
            <button
              type="button"
              className="cosmic-page-close"
              onClick={() => setActivityPageOpen(false)}
              aria-label="Close"
            >✕</button>

            <div className="cosmic-page-grid">
              {/* Streak panel */}
              <aside className="cosmic-page-streak">
                <p className="cosmic-page-eyebrow">Login Streak</p>
                <div className="streak-flame" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2c1 3-1 4-2 6-1.4 2.8.4 4.8 2 4.8 1.2 0 2.1-1 1.9-2.4 1.6 1 2.6 2.7 2.6 4.4A6.4 6.4 0 0 1 5.6 15c0-3 1.9-4.6 3-7 .8-1.9 2.4-3.9 3.4-6z" />
                  </svg>
                </div>
                <div className="streak-count" ref={streakRef}>{user.streak_count ?? 0}</div>
                <div className="streak-label">{(user.streak_count ?? 0) === 1 ? 'day active' : 'days active'}</div>
                <div className="streak-dots" aria-hidden="true">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <span key={i} className={`streak-dot${i < Math.min(user.streak_count ?? 0, 7) ? ' streak-dot--on' : ''}`} />
                  ))}
                </div>
                {(user.longest_streak ?? 0) > 0 && (
                  <p className="cosmic-page-best">Best: {user.longest_streak} day{user.longest_streak === 1 ? '' : 's'}</p>
                )}

                {/* Voyager's Log — fills the panel with a milestone tracker,
                    quick stats, and a cosmic rank earned from the best streak */}
                <div className="streak-extras">
                  <div className="streak-milestone">
                    <div className="streak-milestone-head">
                      <span className="streak-milestone-eyebrow">{nextMilestone ? 'Next Milestone' : 'Legend'}</span>
                      <span className="streak-milestone-target">{nextMilestone ? `${nextMilestone}d` : '★'}</span>
                    </div>
                    <div className="streak-milestone-bar">
                      <span className="streak-milestone-fill" style={{ width: `${milestonePct}%` }} />
                    </div>
                    <p className="streak-milestone-note">
                      {nextMilestone
                        ? `${milestoneToGo} day${milestoneToGo === 1 ? '' : 's'} to go`
                        : 'Every milestone conquered'}
                    </p>
                  </div>

                  <div className="voyager-log">
                    <span className="voyager-log-eyebrow">Voyager's Log</span>
                    <div className="voyager-stats">
                      <div className="voyager-stat">
                        <span className="voyager-stat-num">{ownedBoards.length}</span>
                        <span className="voyager-stat-label">Galaxies</span>
                      </div>
                      <div className="voyager-stat">
                        <span className="voyager-stat-num">{sharedBoards.length}</span>
                        <span className="voyager-stat-label">Shared</span>
                      </div>
                      <div className="voyager-stat">
                        <span className="voyager-stat-num">{guilds.length}</span>
                        <span className="voyager-stat-label">Allies</span>
                      </div>
                    </div>
                  </div>

                  <div className="cosmic-rank" title="Rank earned from your best streak">
                    <span className="cosmic-rank-glyph" aria-hidden="true">✦</span>
                    <span className="cosmic-rank-name">{cosmicRank}</span>
                  </div>
                </div>
              </aside>

              {/* Activity feed */}
              <div className="cosmic-page-feed">
                <p className="cosmic-page-eyebrow">Recent Discoveries</p>
                <div className="cosmic-page-scroll">
                  <ul className="cosmic-activity-list cosmic-page-list" ref={feedListRef}>
                    {activityLoading ? (
                      <li className="cosmic-activity-empty">Charting recent discoveries…</li>
                    ) : activity.length === 0 ? (
                      <li className="cosmic-activity-empty">No discoveries yet — your journey awaits.</li>
                    ) : activity.map(renderActivityRow)}
                  </ul>
                  <span className="cosmic-page-scrollthumb" ref={scrollThumbRef} aria-hidden="true" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
