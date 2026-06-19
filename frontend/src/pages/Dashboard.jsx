import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../api.js'
import { COLUMN_PALETTE } from '../constants.js'

// Board previews are fetched on hover and cached for the session so a second
// hover is instant.
const previewCache = new Map()

// Compact "time since" label, e.g. "3h ago", "2d ago".
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

  // close when clicking outside
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

  // Everyone on the board (owner first), for the member avatars. Show a few and
  // roll the rest into a "+N" chip so a crowded board still reads cleanly.
  const members = board.members || []
  const shownMembers = members.slice(0, 4)
  const extraMembers = members.length - shownMembers.length

  // Real mini-kanban preview: a bar per column, height scaled to its card count.
  // Empty boards fall back to three short stubs so the tile still reads as a board.
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
    // recentre the torchlight so it fades from the middle, not its last spot
    e?.currentTarget?.style.setProperty('--mx', '50%')
    e?.currentTarget?.style.setProperty('--my', '0%')
  }

  // Torchlight: a specular highlight on the tile that follows the cursor, so
  // each board reads as an enchanted relic catching candlelight on the atlas.
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
      {/* mini-kanban motif: clipped face holds the column bars (one per list,
          height scaled to card count) + ghost monogram */}
      <div className="board-tile-face" aria-hidden="true">
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
        <div className="board-tile-info-text">
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
              <span key={m.id} className="board-tile-avatar" title={m.username}>
                {(m.username[0] || '?').toUpperCase()}
              </span>
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

function BoardTileSkeleton() {
  return (
    <div className="board-tile board-tile--skeleton" aria-hidden="true">
      <span className="skeleton-bar skeleton-bar--title" />
      <span className="skeleton-bar skeleton-bar--meta" />
    </div>
  )
}

// Remember how many boards a user had last time so the skeleton matches their
// real count instead of a guess. Falls back to `fallback` on a first visit.
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

export default function Dashboard({ user, onOpenBoard, onLogout, onOpenSettings }) {
  const [boards, setBoards] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('mine')
  const [newTitle, setNewTitle] = useState('')
  const [addingBoard, setAddingBoard] = useState(false)

  const ownedKey = `dash:${user.id}:ownedCount`
  const sharedKey = `dash:${user.id}:sharedCount`
  // read once at mount — the counts from the previous visit drive the skeletons
  const [skeletonOwned] = useState(() => readSkeletonCount(ownedKey, 3))
  const [skeletonShared] = useState(() => readSkeletonCount(sharedKey, 2))

  useEffect(() => {
    apiFetch('/api/boards')
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : []
        setBoards(list)
        setLoading(false)
        // remember this visit's counts for next time's skeleton
        try {
          localStorage.setItem(ownedKey, list.filter(b => b.role === 'owner').length)
          localStorage.setItem(sharedKey, list.filter(b => b.role === 'member').length)
        } catch { /* ignore storage failures */ }
      })
  }, [])

  async function createBoard(e) {
    e.preventDefault()
    if (!newTitle.trim()) return
    const res = await apiFetch('/api/boards', {
      method: 'POST',
      body: JSON.stringify({ title: newTitle.trim() }),
    })
    const board = await res.json()
    setBoards(b => [...b, board])
    setNewTitle('')
    setAddingBoard(false)
  }

  async function deleteBoard(boardId) {
    await apiFetch(`/api/boards/${boardId}`, { method: 'DELETE' })
    setBoards(b => b.filter(board => board.id !== boardId))
  }

  async function renameBoard(boardId, newTitle) {
    const res = await apiFetch(`/api/boards/${boardId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: newTitle }),
    })
    const updated = await res.json()
    setBoards(b => b.map(board => board.id === boardId ? { ...board, title: updated.title } : board))
  }

  const ownedBoards = boards.filter(b => b.role === 'owner')
  const sharedBoards = boards.filter(b => b.role === 'member')

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const today = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  const summary = loading
    ? 'Loading your boards…'
    : ownedBoards.length === 0 && sharedBoards.length === 0
      ? 'No boards yet — make your first one to get rolling.'
      : `${ownedBoards.length} board${ownedBoards.length === 1 ? '' : 's'}` +
        (sharedBoards.length ? ` · ${sharedBoards.length} shared with you` : '') +
        ' · pick one to warp in.'

  return (
    <div className="dashboard-shell">
      {/* an arcane comet streaks across the sky every several seconds */}
      <div className="sky-comet" aria-hidden="true">
        <div className="sky-comet-streak" />
      </div>

      <header className="topbar">
        <div className="topbar-left">
          <div className="board-icon">S</div>
          <span className="board-name" style={{ cursor: 'default' }}>Scuffed Trello</span>
        </div>
        <div className="topbar-right">
          <button
            className="dashboard-username dashboard-username--link"
            onClick={onOpenSettings}
            title="Account settings"
          >
            {user.username}
          </button>
          <button className="btn-ghost logout-btn" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <main className="dashboard-main">
        <section className="dash-hero">
          <p className="dash-hero-eyebrow">{today}</p>
          <h1 className="dash-hero-greeting">{greeting}, {user.username}.</h1>
          <p className="dash-hero-summary">{summary}</p>
        </section>

        <div className="dash-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'mine'}
            className={`dash-tab${activeTab === 'mine' ? ' active' : ''}`}
            onClick={() => setActiveTab('mine')}
          >
            My boards
            {ownedBoards.length > 0 && <span className="dash-tab-count">{ownedBoards.length}</span>}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'shared'}
            className={`dash-tab${activeTab === 'shared' ? ' active' : ''}`}
            onClick={() => setActiveTab('shared')}
          >
            Shared with me
            {sharedBoards.length > 0 && <span className="dash-tab-count">{sharedBoards.length}</span>}
          </button>
        </div>

        {activeTab === 'mine' && (
          <section className="dashboard-section">
            {addingBoard && (
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

            <div className="board-grid">
              {!addingBoard && (
                <button className="board-tile board-tile--create" style={{ '--stagger': 0 }} onClick={() => setAddingBoard(true)}>
                  <span className="board-tile-plus" aria-hidden="true">+</span>
                  <span className="board-tile-create-label">Create a New World</span>
                </button>
              )}
              {loading
                ? Array.from({ length: skeletonOwned }).map((_, i) => <BoardTileSkeleton key={i} />)
                : ownedBoards.map((b, i) => (
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
            </div>
          </section>
        )}

        {activeTab === 'shared' && (
          <section className="dashboard-section">
            {loading ? (
              <div className="board-grid">
                {Array.from({ length: skeletonShared }).map((_, i) => <BoardTileSkeleton key={i} />)}
              </div>
            ) : sharedBoards.length === 0 ? (
              <p className="dashboard-empty">Nothing shared with you yet. When a teammate invites you, it lands here.</p>
            ) : (
              <div className="board-grid">
                {sharedBoards.map((b, i) => (
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
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
