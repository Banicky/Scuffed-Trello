import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { gsap } from 'gsap'
import Column from '../components/Column.jsx'
import CardDetailModal, { formatDate, describeHistory } from '../components/CardDetailModal.jsx'
import ImageUploadField from '../components/ImageUploadField.jsx'
import UserAvatar from '../components/UserAvatar.jsx'
import AiAssistant from '../components/AiAssistant.jsx'
import { apiFetch, assetUrl, exportBoard, importBoard } from '../api.js'
import { socket, joinBoard, leaveBoard } from '../socket.js'
import { buildSearchRegex } from '../utils.js'
import { ZODIAC_CONSTELLATIONS } from '../constants.js'

// Canonical orderings mirroring the server: cards are starred-first then by
// position; columns by position. Applied when reconciling remote real-time
// events so every client converges on the same layout the REST load produces.
function sortCards(cards) {
  return [...cards].sort((a, b) => {
    const sa = a.starred ? 1 : 0, sb = b.starred ? 1 : 0
    if (sa !== sb) return sb - sa
    return (a.position ?? 0) - (b.position ?? 0)
  })
}
function sortColumns(cols) {
  return [...cols].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
}

// Stylised stroke glyphs for the topbar toggles, matching the app's celestial
// line-icon language (currentColor stroke, rounded joins). Members = three
// overlapping community rings; Design = a four-point star set in a hex frame.
function MembersGlyph() {
  return (
    <svg className="btn-glyph" width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8.5" r="4.4" />
      <circle cx="8" cy="15" r="4.4" />
      <circle cx="16" cy="15" r="4.4" />
    </svg>
  )
}

function DesignGlyph() {
  return (
    <svg className="btn-glyph" width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.5l8.23 4.75v9.5L12 21.5l-8.23-4.75v-9.5z" />
      <path d="M12 8l1.15 2.85L16 12l-2.85 1.15L12 16l-1.15-2.85L8 12l2.85-1.15z" />
    </svg>
  )
}

function HistoryGlyph() {
  return (
    <svg className="btn-glyph" width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4l3 2" />
    </svg>
  )
}

// Anchors a toggle panel (Design/Members/History) directly under whichever
// button opened it, instead of a fixed top-right screen position — which
// otherwise leaves panels like Design (not the rightmost button) looking
// stranded far from the button that triggered them. Falls back to the old
// fixed spot for the one frame before layout has measured the button.
function useAnchorPos(btnRef, isOpen) {
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    if (!isOpen || !btnRef.current) { setPos(null); return }
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 8, right: window.innerWidth - r.right })
  }, [isOpen, btnRef])
  return pos || { top: 56, right: 16 }
}

// Board-wide equivalent of the per-card history rail: same query shape
// (/api/boards/:id/history mirrors /api/cards/:id/history), and reuses its
// describeHistory/formatDate + .card-history-* rendering so entries read
// identically whether you're looking at one card or the whole board.
function BoardHistoryPanel({ boardId, onClose }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    apiFetch(`/api/boards/${boardId}/history`)
      .then(r => r.json())
      .then(data => { if (active) setHistory(Array.isArray(data) ? data : []) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [boardId])

  return (
    <div className="members-panel board-members-panel board-history-panel">
      <div className="members-panel-header">
        <span className="members-panel-title">Board history</span>
        <button className="members-panel-close" onClick={onClose}>✕</button>
      </div>
      <ul className="card-history-list">
        {!loading && history.length === 0 && (
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
    </div>
  )
}

function MembersPanel({ boardId, isOwner, onClose }) {
  const [members, setMembers] = useState([])
  const [invite, setInvite] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState('')

  useEffect(() => {
    let active = true
    const load = () => apiFetch(`/api/boards/${boardId}/members`)
      .then(r => r.json())
      .then(data => { if (active) setMembers(Array.isArray(data) ? data : []) })
      .catch(() => {})
    load()
    // refresh while the panel is open so the active/inactive glow stays live as
    // members come and go (heartbeat-driven; see is_active on the members API)
    const id = setInterval(load, 20000)
    return () => { active = false; clearInterval(id) }
  }, [boardId])

  async function handleInvite(e) {
    e.preventDefault()
    setError('')
    setSent('')
    // sends an invitation missive — they only join once they accept it,
    // so nothing is added to the member list here
    const res = await apiFetch(`/api/boards/${boardId}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: invite.trim() }),
    })
    const data = await res.json()
    if (!res.ok) return setError(data.error)
    setSent(`Missive dispatched to ${data.invitee?.username || invite.trim()} — awaiting their answer.`)
    setInvite('')
  }

  async function handleRemove(userId) {
    await apiFetch(`/api/boards/${boardId}/members/${userId}`, { method: 'DELETE' })
    setMembers(m => m.filter(u => u.id !== userId))
  }

  return (
    <div className="members-panel board-members-panel">
      <div className="members-panel-header">
        <span className="members-panel-title">Members</span>
        <button className="members-panel-close" onClick={onClose}>✕</button>
      </div>
      <ul className="members-list">
        {members.map(u => (
          <li key={u.id} className="member-row">
            <span className="member-avatar-wrap">
              <UserAvatar user={u} className="avatar member-avatar" />
              <span
                className={`member-status ${u.is_active ? 'member-status--active' : 'member-status--inactive'}`}
                title={u.is_active ? 'Active' : 'Offline'}
                aria-label={u.is_active ? 'Active' : 'Offline'}
              />
            </span>
            <span className="member-name">{u.username}</span>
            {u.is_owner && (
              <span className="member-owner-crown" title="Board owner" aria-label="Board owner">👑</span>
            )}
            {isOwner && !u.is_owner && (
              <button className="member-remove" onClick={() => handleRemove(u.id)} title="Remove">✕</button>
            )}
          </li>
        ))}
        {members.length === 0 && <li className="members-empty">No members yet.</li>}
      </ul>
      {isOwner && (
        <form className="invite-form" onSubmit={handleInvite}>
          <input
            className="card-input"
            placeholder="Username or email"
            value={invite}
            onChange={e => { setInvite(e.target.value); setSent('') }}
            maxLength={255}
          />
          <button className="btn-primary" type="submit">Invite</button>
        </form>
      )}
      {sent && <p className="invite-sent-note">✦ {sent}</p>}
      {error && <p className="auth-error" style={{ marginTop: 6 }}>{error}</p>}
    </div>
  )
}

export default function BoardView({ boardId, user, onBack, onReady, onOpenSettings }) {
  const [columns, setColumns] = useState([])
  const [loading, setLoading] = useState(true)
  const [board, setBoard] = useState(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [dragOverColId, setDragOverColId] = useState(null)
  const [dragOverCardId, setDragOverCardId] = useState(null)
  const [showMembers, setShowMembers] = useState(false)
  const [showDesign, setShowDesign] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const designBtnRef = useRef(null)
  const membersBtnRef = useRef(null)
  const historyBtnRef = useRef(null)
  const designPos = useAnchorPos(designBtnRef, showDesign)
  const membersPos = useAnchorPos(membersBtnRef, showMembers)
  const historyPos = useAnchorPos(historyBtnRef, showHistory)
  const [columnLimitError, setColumnLimitError] = useState(false)
  const [draggingColId, setDraggingColId] = useState(null)
  const [colDragOverId, setColDragOverId] = useState(null)
  const [detailCard, setDetailCard] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const [ioBusy, setIoBusy] = useState(false)
  const [ioMessage, setIoMessage] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const cardRefs = useRef(new Map())
  const importInputRef = useRef(null)

  // Carry the dashboard's day/night sky into the board. The choice lives in the
  // same `dash-color-mode` key the dashboard writes, so the theme persists as
  // the user moves between the two views.
  const modeFxRef = useRef(null)  // full-screen veil that cross-fades the swap
  const modeIconRef = useRef(null)
  const [colorMode, setColorMode] = useState(() => localStorage.getItem('dash-color-mode') || 'night')
  function applyColorMode(next) {
    localStorage.setItem('dash-color-mode', next)
    setColorMode(next)
  }
  // Mirror the dashboard's switch: a veil in the incoming sky's tone fades in, we
  // swap the theme underneath while it's opaque, then it fades back out to reveal
  // the new sky — so the recolor never reads as a harsh flash.
  function toggleColorMode() {
    const next = colorMode === 'night' ? 'day' : 'night'

    // little pop on the toggle glyph
    if (modeIconRef.current) {
      gsap.fromTo(modeIconRef.current,
        { rotate: -90, scale: 0.4, opacity: 0 },
        { rotate: 0, scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(2)' })
    }

    const fx = modeFxRef.current
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!fx || reduced) { applyColorMode(next); return }

    fx.style.background = next === 'day' ? '#ccd4e0' : '#06070b'
    gsap.timeline()
      .set(fx, { autoAlpha: 0 })
      .to(fx, { autoAlpha: 1, duration: 0.26, ease: 'power1.inOut' })
      .add(() => applyColorMode(next))
      .to(fx, { autoAlpha: 0, duration: 0.34, ease: 'power1.inOut' })
  }

  const isOwner = board?.owner_id === user.id

  // The same zodiac sign the board's dashboard tile shows (board.id % 12), drawn
  // small in the topbar icon so a board reads consistently across both views.
  const zodiac = board ? ZODIAC_CONSTELLATIONS[board.id % ZODIAC_CONSTELLATIONS.length] : null

  const matches = useMemo(() => {
    const query = searchQuery.trim()
    // Card id search: a leading '#' followed by digits matches that card id exactly.
    const idMatch = query.match(/^#(\d+)$/)
    if (idMatch) {
      const targetId = Number(idMatch[1])
      const found = []
      columns.forEach(col => {
        col.cards.forEach(card => {
          if (card.id === targetId) found.push(card.id)
        })
      })
      return found
    }
    const regex = buildSearchRegex(query, { caseSensitive, wholeWord })
    if (!regex) return []
    const found = []
    columns.forEach(col => {
      col.cards.forEach(card => {
        if (regex.test(card.title) || regex.test(card.description || '')) found.push(card.id)
      })
    })
    return found
  }, [searchQuery, caseSensitive, wholeWord, columns])

  useEffect(() => {
    setActiveMatchIndex(0)
  }, [searchQuery, caseSensitive, wholeWord])

  useEffect(() => {
    if (!matches.length) return
    const idx = Math.min(activeMatchIndex, matches.length - 1)
    const el = cardRefs.current.get(matches[idx])
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [matches, activeMatchIndex])

  function registerCardRef(cardId, node) {
    if (node) cardRefs.current.set(cardId, node)
    else cardRefs.current.delete(cardId)
  }

  const activeMatchCardId = matches.length ? matches[Math.min(activeMatchIndex, matches.length - 1)] : null

  function goToMatch(delta) {
    if (!matches.length) return
    setActiveMatchIndex(i => (i + delta + matches.length) % matches.length)
  }

  // Fetch the board, its columns, and each column's cards into state. Returns
  // true on success; on access failure it escalates back to the dashboard.
  async function loadBoard() {
    const [colRes, boardRes] = await Promise.all([
      apiFetch(`/api/boards/${boardId}/columns`),
      apiFetch(`/api/boards/${boardId}`),
    ])

    // escalates to main dashboard if the id is invalid or user doesn't have access, instead of showing an error message on this page
    if (!boardRes.ok || !colRes.ok) {
      onBack()
      return false
    }
    const cols = await colRes.json()
    const boardData = await boardRes.json()
    setBoard(boardData)

    const withCards = await Promise.all(cols.map(async col => {
      const cardRes = await apiFetch(`/api/columns/${col.id}/cards`)
      const cards = await cardRes.json()
      const sorted = [...cards].sort((a, b) => b.starred - a.starred)
      return { ...col, cards: sorted }
    }))

    setColumns(withCards)
    setLoading(false)
    return true
  }

  useEffect(() => {
    loadBoard()
  }, [boardId])

  // ── Real-time collaboration ───────────────────────────────────────────────
  // Join this board's room and apply changes other members make. Every handler
  // is server-authoritative: payloads carry the resulting DB row(s), which we
  // reconcile by id and re-sort, so concurrent edits converge. The acting client
  // is excluded server-side (via the X-Socket-Id header) and never sees an echo.
  useEffect(() => {
    if (boardId == null) return

    const stopJoin = joinBoard(boardId)

    // Remove a card from whichever column holds it, returning the columns with
    // it stripped plus the card object we found (to merge enriched fields).
    function stripCard(cols, cardId) {
      let found = null
      const next = cols.map(col => {
        const hit = col.cards.find(c => c.id === cardId)
        if (hit) found = hit
        return hit ? { ...col, cards: col.cards.filter(c => c.id !== cardId) } : col
      })
      return [next, found]
    }

    const handlers = {
      'column:created': ({ column }) => setColumns(cols =>
        cols.some(c => c.id === column.id) ? cols : sortColumns([...cols, { ...column, cards: [] }])
      ),
      'column:updated': ({ column }) => setColumns(cols => sortColumns(
        cols.map(c => c.id === column.id ? { ...c, title: column.title, position: column.position } : c)
      )),
      'column:deleted': ({ columnId }) => setColumns(cols => cols.filter(c => c.id !== columnId)),

      'card:created': ({ columnId, card }) => setColumns(cols => cols.map(col =>
        col.id === columnId && !col.cards.some(c => c.id === card.id)
          ? { ...col, cards: sortCards([...col.cards, card]) }
          : col
      )),
      'card:updated': ({ card }) => {
        setColumns(cols => {
          const [stripped, existing] = stripCard(cols, card.id)
          const merged = { ...(existing || {}), ...card }
          return stripped.map(col =>
            col.id === card.column_id ? { ...col, cards: sortCards([...col.cards, merged]) } : col
          )
        })
        setDetailCard(d => d && d.id === card.id ? { ...d, ...card } : d)
      },
      'card:deleted': ({ cardId }) => setColumns(cols => stripCard(cols, cardId)[0]),

      'card:assignees': ({ cardId, assignees }) => {
        setColumns(cols => cols.map(col => ({
          ...col,
          cards: col.cards.map(c => c.id === cardId ? { ...c, assignees } : c),
        })))
        setDetailCard(d => d && d.id === cardId ? { ...d, assignees } : d)
      },

      // Comment add/remove only shifts the board-face count badge; the open
      // detail modal maintains the comment list itself via its own subscription.
      'comment:created': ({ cardId }) => setColumns(cols => cols.map(col => ({
        ...col,
        cards: col.cards.map(c => c.id === cardId ? { ...c, comment_count: (c.comment_count ?? 0) + 1 } : c),
      }))),
      'comment:deleted': ({ cardId }) => setColumns(cols => cols.map(col => ({
        ...col,
        cards: col.cards.map(c => c.id === cardId ? { ...c, comment_count: Math.max(0, (c.comment_count ?? 0) - 1) } : c),
      }))),

      'board:updated': ({ board: b }) => setBoard(prev => prev ? { ...prev, ...b } : b),
      'board:reload': () => loadBoard(),
    }

    for (const [event, fn] of Object.entries(handlers)) socket.on(event, fn)
    return () => {
      for (const [event, fn] of Object.entries(handlers)) socket.off(event, fn)
      stopJoin?.()
      leaveBoard(boardId)
    }
  }, [boardId])

  async function handleExport() {
    setIoMessage('')
    setIoBusy(true)
    try {
      await exportBoard(board.id, board.title)
    } catch (err) {
      setIoMessage(err.message)
    } finally {
      setIoBusy(false)
    }
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-importing the same file later
    if (!file) return
    if (!window.confirm('Importing will replace this board\'s columns and cards. Continue?')) return
    setIoMessage('')
    setIoBusy(true)
    try {
      const text = await file.text()
      let doc
      try { doc = JSON.parse(text) } catch { throw new Error('That file is not valid JSON') }
      await importBoard(board.id, doc)
      await loadBoard()
      setIoMessage('Board imported')
      setTimeout(() => setIoMessage(''), 3000)
    } catch (err) {
      setIoMessage(err.message)
    } finally {
      setIoBusy(false)
    }
  }

  // Tell the portal the board has painted (one rAF after loading clears) so it
  // holds the veil over the heavy first render, then fades to reveal it.
  const readyFired = useRef(false)
  useEffect(() => {
    if (loading || readyFired.current) return
    readyFired.current = true
    const id = requestAnimationFrame(() => onReady?.())
    return () => cancelAnimationFrame(id)
  }, [loading, onReady])

  async function renameBoard(newTitle) {
    if (!newTitle.trim() || newTitle === board.title) return
    const res = await apiFetch(`/api/boards/${board.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: newTitle.trim() }),
    })
    const updated = await res.json()
    setBoard(updated)
  }

  // Apply a board-design change (background image or opacity). Updates locally
  // at once for a live preview, then saves — debounced for the opacity slider so
  // dragging it doesn't fire a request per step.
  const designSaveTimer = useRef(null)
  function setDesign(patch, { debounce = false } = {}) {
    setBoard(b => ({ ...b, ...patch }))
    clearTimeout(designSaveTimer.current)
    const save = () => apiFetch(`/api/boards/${board.id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (debounce) designSaveTimer.current = setTimeout(save, 350)
    else save()
  }

  async function addCard(columnId, cardData, position) {
    const res = await apiFetch('/api/cards', {
      method: 'POST',
      body: JSON.stringify({ column_id: columnId, position, ...cardData }),
    })
    const newCard = await res.json()
    setColumns(cols => cols.map(col =>
      col.id === columnId ? { ...col, cards: [...col.cards, newCard] } : col
    ))
  }

  async function editCard(columnId, cardId, cardData) {
    const res = await apiFetch(`/api/cards/${cardId}`, {
      method: 'PATCH',
      body: JSON.stringify(cardData),
    })
    const updated = await res.json()
    setColumns(cols => cols.map(col =>
      col.id === columnId
        ? { ...col, cards: col.cards.map(c => c.id === cardId ? { ...c, ...updated } : c) }
        : col
    ))
  }

  async function toggleStar(columnId, cardId, currentStarred) {
    const newStarred = !currentStarred
    await apiFetch(`/api/cards/${cardId}`, {
      method: 'PATCH',
      body: JSON.stringify({ starred: newStarred }),
    })

    const col = columns.find(c => c.id === columnId)
    const updated = col.cards.map(c => c.id === cardId ? { ...c, starred: newStarred } : c)
    const reordered = [
      ...updated.filter(c => c.starred),
      ...updated.filter(c => !c.starred),
    ]

    setColumns(cols => cols.map(c =>
      c.id === columnId ? { ...c, cards: reordered } : c
    ))

    await Promise.all(reordered.map((c, i) =>
      apiFetch(`/api/cards/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ column_id: columnId, position: i }),
      })
    ))
  }

  async function addColumn() {
    if (columns.length >= 10) {
      setColumnLimitError(true)
      setTimeout(() => setColumnLimitError(false), 3000)
      return
    }
    const position = columns.length
    const res = await apiFetch('/api/columns', {
      method: 'POST',
      body: JSON.stringify({ board_id: board.id, title: 'New Column', position }),
    })
    const newCol = await res.json()
    setColumns(cols => [...cols, { ...newCol, cards: [], editingTitle: true }])
  }

  async function renameColumn(columnId, newTitle) {
    if (!newTitle.trim()) return
    const res = await apiFetch(`/api/columns/${columnId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: newTitle.trim() }),
    })
    const updated = await res.json()
    setColumns(cols => cols.map(col =>
      col.id === columnId ? { ...col, title: updated.title } : col
    ))
  }

  async function deleteColumn(columnId) {
    await apiFetch(`/api/columns/${columnId}`, { method: 'DELETE' })
    setColumns(cols => cols.filter(col => col.id !== columnId))
  }

  async function deleteCard(columnId, cardId) {
    await apiFetch(`/api/cards/${cardId}`, { method: 'DELETE' })
    setColumns(cols => cols.map(col =>
      col.id === columnId ? { ...col, cards: col.cards.filter(c => c.id !== cardId) } : col
    ))
  }

  // Dragging one column onto another just swaps the two — they trade places and
  // every other column stays put. Only the two swapped columns change position
  // (position tracks the array index), so only those two need persisting.
  async function moveColumn(draggedColId, targetColId) {
    if (draggedColId === targetColId) return
    const from = columns.findIndex(c => c.id === draggedColId)
    const to = columns.findIndex(c => c.id === targetColId)
    if (from === -1 || to === -1) return
    const reordered = [...columns]
    ;[reordered[from], reordered[to]] = [reordered[to], reordered[from]]
    setColumns(reordered)
    await Promise.all([from, to].map(i =>
      apiFetch(`/api/columns/${reordered[i].id}`, {
        method: 'PATCH',
        body: JSON.stringify({ position: i }),
      })
    ))
  }

  async function moveCard(e, targetColumnId) {
    const cardId = Number(e.dataTransfer.getData('cardId'))
    const overCardId = dragOverCardId
    setDragOverColId(null)
    setDragOverCardId(null)

    const sourceCol = columns.find(col => col.cards.some(c => c.id === cardId))
    if (!sourceCol) return

    const card = sourceCol.cards.find(c => c.id === cardId)
    const sameColumn = sourceCol.id === targetColumnId

    function clampInsert(dragged, pool, rawAt) {
      const starredCount = pool.filter(c => c.starred).length
      return dragged.starred ? Math.min(rawAt, starredCount) : Math.max(rawAt, starredCount)
    }

    let updatedSourceCards, updatedTargetCards

    if (sameColumn) {
      const cards = sourceCol.cards.filter(c => c.id !== cardId)
      const rawAt = overCardId ? cards.findIndex(c => c.id === overCardId) : cards.length
      const insertAt = clampInsert(card, cards, rawAt >= 0 ? rawAt : cards.length)
      cards.splice(insertAt, 0, card)
      updatedSourceCards = cards
      updatedTargetCards = cards

      if (cards.map(c => c.id).join() === sourceCol.cards.map(c => c.id).join()) return

      setColumns(cols => cols.map(col =>
        col.id === targetColumnId ? { ...col, cards } : col
      ))
    } else {
      updatedSourceCards = sourceCol.cards.filter(c => c.id !== cardId)
      const targetCol = columns.find(col => col.id === targetColumnId)
      const targetCards = [...targetCol.cards]
      const rawAt = overCardId ? targetCards.findIndex(c => c.id === overCardId) : targetCards.length
      const insertAt = clampInsert(card, targetCards, rawAt >= 0 ? rawAt : targetCards.length)
      targetCards.splice(insertAt, 0, card)
      updatedTargetCards = targetCards

      setColumns(cols => cols.map(col => {
        if (col.id === sourceCol.id) return { ...col, cards: updatedSourceCards }
        if (col.id === targetColumnId) return { ...col, cards: updatedTargetCards }
        return col
      }))
    }

    const toPatch = sameColumn
      ? updatedTargetCards.map((c, i) => ({ id: c.id, column_id: targetColumnId, position: i, track_edit: c.id === cardId }))
      : [
          ...updatedSourceCards.map((c, i) => ({ id: c.id, column_id: sourceCol.id, position: i, track_edit: c.id === cardId })),
          ...updatedTargetCards.map((c, i) => ({ id: c.id, column_id: targetColumnId, position: i, track_edit: c.id === cardId })),
        ]

    const responses = await Promise.all(toPatch.map(({ id, column_id, position, track_edit }) =>
      apiFetch(`/api/cards/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ column_id, position, track_edit }),
      }).then(r => r.json())
    ))

    const movedCard = responses.find(r => r.id === cardId)
    if (movedCard?.last_edited_by_username) {
      setColumns(cols => cols.map(col => ({
        ...col,
        cards: col.cards.map(c => c.id === cardId ? { ...c, last_edited_by_username: movedCard.last_edited_by_username } : c),
      })))
    }
  }

  const totalCards = columns.reduce((sum, col) => sum + col.cards.length, 0)
  const doneCol = columns.find(c => c.title.toUpperCase() === 'DONE')
  const doneCount = doneCol?.cards.length ?? 0

  if (loading) return (
    <div className={`app-shell board-shell${colorMode === 'day' ? ' board-shell--day' : ''}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}>
      Journeying…
    </div>
  )

  return (
    <div className={`app-shell board-shell${colorMode === 'day' ? ' board-shell--day' : ''}${aiOpen ? ' ai-open' : ''}`}>
      <span className="mode-fx" ref={modeFxRef} aria-hidden="true" />
      <div className="board-stage">
      {board?.background_image && (
        <div
          className="board-bg-overlay"
          aria-hidden="true"
          style={{
            backgroundImage: `url(${assetUrl(board.background_image)})`,
            opacity: (board.background_opacity ?? 10) / 100,
          }}
        />
      )}
      <header
        className="topbar"
        onClickCapture={e => {
          // Delegated so every header button gets the click "flair" for free —
          // no need to touch each button's own onClick. Remove-then-reflow-then-
          // add restarts the CSS animation even on rapid repeat clicks.
          const btn = e.target.closest('button')
          if (!btn || btn.disabled) return
          btn.classList.remove('btn-pop')
          void btn.offsetWidth
          btn.classList.add('btn-pop')
        }}
      >
        <div className="topbar-left">
          <button className="back-btn" onClick={onBack} title="Back to dashboard">←</button>
          <div className="board-icon board-icon--constellation" title={zodiac?.name} aria-label={zodiac ? `${zodiac.name} constellation` : undefined}>
            {zodiac && (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <polyline
                  className="board-icon-zodiac-line"
                  points={zodiac.points.map(([x, y]) => `${x},${y}`).join(' ')}
                />
                {zodiac.points.map(([x, y], i) => (
                  <circle key={i} className="board-icon-zodiac-star" cx={x} cy={y} r={i % 3 === 0 ? 3 : 2} />
                ))}
              </svg>
            )}
          </div>
          <div>
            {editingTitle ? (
              <input
                className="board-name-input"
                defaultValue={board.title}
                maxLength={255}
                autoFocus
                onBlur={e => { renameBoard(e.target.value); setEditingTitle(false) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { renameBoard(e.target.value); setEditingTitle(false) }
                  if (e.key === 'Escape') setEditingTitle(false)
                }}
              />
            ) : (
              <div className="board-name" onClick={() => setEditingTitle(true)} title="Click to rename">
                {board.title}
              </div>
            )}
            <div className="board-meta">{totalCards} cards · {doneCount} done</div>
          </div>
          <div className="board-io">
            <button
              className="btn-ghost board-io-btn"
              onClick={handleExport}
              disabled={ioBusy}
              title="Download this board as a JSON file"
            >
              ⬇ Export
            </button>
            <button
              className="btn-ghost board-io-btn"
              onClick={() => importInputRef.current?.click()}
              disabled={ioBusy}
              title="Replace this board from a JSON file"
            >
              ⬆ Import
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
            {ioMessage && <span className="board-io-msg">{ioMessage}</span>}
          </div>
        </div>
        <div className="topbar-search">
          <div className="search-input-wrap">
            <input
              className="search-input"
              placeholder="Search cards…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { setSearchQuery(''); e.currentTarget.blur() }
              }}
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => setSearchQuery('')} title="Clear search">✕</button>
            )}
          </div>
          <button
            className={`search-toggle${caseSensitive ? ' active' : ''}`}
            onClick={() => setCaseSensitive(v => !v)}
            title="Case sensitive"
          >
            Aa
          </button>
          <button
            className={`search-toggle${wholeWord ? ' active' : ''}`}
            onClick={() => setWholeWord(v => !v)}
            title="Match whole word"
          >
            “ab”
          </button>
          {searchQuery.trim() && (
            <div className="search-nav">
              <span className="search-count">{matches.length ? `${activeMatchIndex + 1}/${matches.length}` : '0/0'}</span>
              <button className="search-nav-btn" onClick={() => goToMatch(-1)} disabled={!matches.length} title="Previous match">↑</button>
              <button className="search-nav-btn" onClick={() => goToMatch(1)} disabled={!matches.length} title="Next match">↓</button>
            </div>
          )}
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              )}
            </span>
          </button>
          {isOwner && (
            <button
              ref={designBtnRef}
              className={`btn-ghost members-toggle${showDesign ? ' active' : ''}`}
              onClick={() => setShowDesign(v => !v)}
            >
              <DesignGlyph />
              Design
            </button>
          )}
          <button
            ref={membersBtnRef}
            className={`btn-ghost members-toggle${showMembers ? ' active' : ''}`}
            onClick={() => setShowMembers(v => !v)}
          >
            <MembersGlyph />
            Members
          </button>
          <button
            ref={historyBtnRef}
            className={`btn-ghost members-toggle${showHistory ? ' active' : ''}`}
            onClick={() => setShowHistory(v => !v)}
          >
            <HistoryGlyph />
            History
          </button>
          <button
            className={`btn-ghost members-toggle ai-toggle${aiOpen ? ' active' : ''}`}
            onClick={() => setAiOpen(v => !v)}
            title="AI assistant"
            aria-pressed={aiOpen}
          >
            ✦ Assistant
          </button>
          <button
            className="avatar avatar--btn"
            title="Account settings"
            onClick={() => onOpenSettings?.('security')}
          >
            <UserAvatar user={user} className="avatar" />
          </button>
        </div>
      </header>

      {showDesign && (
        <div className="board-members-overlay" onClick={() => setShowDesign(false)}>
          <div className="board-panel-anchor" style={designPos} onClick={e => e.stopPropagation()}>
            <div className="members-panel board-members-panel board-design-panel">
              <div className="members-panel-header">
                <span className="members-panel-title">Board design</span>
                <button className="members-panel-close" onClick={() => setShowDesign(false)}>✕</button>
              </div>
              <p className="board-design-hint">
                Add an image to drape over your board. It sits behind the lists,
                so your cards stay readable.
              </p>
              <ImageUploadField
                value={board.background_image}
                onChange={url => setDesign({ background_image: url })}
                type="boards"
              />
              {board.background_image && (
                <label className="board-design-opacity">
                  <span>Overlay strength</span>
                  <input
                    type="range"
                    min="5"
                    max="100"
                    value={board.background_opacity ?? 10}
                    onChange={e => setDesign({ background_opacity: Number(e.target.value) }, { debounce: true })}
                  />
                  <span className="board-design-opacity-val">{board.background_opacity ?? 10}%</span>
                </label>
              )}
            </div>
          </div>
        </div>
      )}

      {showMembers && (
        <div className="board-members-overlay" onClick={() => setShowMembers(false)}>
          <div className="board-panel-anchor" style={membersPos} onClick={e => e.stopPropagation()}>
            <MembersPanel boardId={boardId} isOwner={isOwner} onClose={() => setShowMembers(false)} />
          </div>
        </div>
      )}

      {showHistory && (
        <div className="board-members-overlay" onClick={() => setShowHistory(false)}>
          <div className="board-panel-anchor" style={historyPos} onClick={e => e.stopPropagation()}>
            <BoardHistoryPanel boardId={boardId} onClose={() => setShowHistory(false)} />
          </div>
        </div>
      )}

      {detailCard && (
        <CardDetailModal
          card={detailCard}
          boardId={boardId}
          currentUserId={user.id}
          onClose={() => setDetailCard(null)}
          onCommentCountChange={count => setColumns(cols => cols.map(col => ({
            ...col,
            cards: col.cards.map(c => c.id === detailCard.id ? { ...c, comment_count: count } : c),
          })))}
          onAssigneesChange={assignees => {
            setDetailCard(c => c ? { ...c, assignees } : c)
            setColumns(cols => cols.map(col => ({
              ...col,
              cards: col.cards.map(c => c.id === detailCard.id ? { ...c, assignees } : c),
            })))
          }}
        />
      )}

      <main className="board">
        {columns.map((col, i) => {
          const draggingIdx = columns.findIndex(c => c.id === draggingColId)
          const overIdx = columns.findIndex(c => c.id === colDragOverId)
          const colDragDirection = draggingColId && colDragOverId && draggingIdx !== overIdx
            ? (draggingIdx < overIdx ? 'right' : 'left')
            : null
          return (
          <Column
            key={col.id}
            column={col}
            colorIndex={i}
            onAddCard={addCard}
            onDeleteCard={deleteCard}
            onToggleStar={(cardId, starred) => toggleStar(col.id, cardId, starred)}
            onEdit={editCard}
            onRenameColumn={renameColumn}
            onDeleteColumn={deleteColumn}
            onDragOver={colId => {
              if (draggingColId !== null) setColDragOverId(colId)
              else setDragOverColId(colId)
            }}
            onDrop={moveCard}
            isDragOver={draggingColId === null && dragOverColId === col.id}
            isDraggingCol={col.id === draggingColId}
            isColDropTarget={draggingColId !== null && draggingColId !== col.id && colDragOverId === col.id}
            colDragDirection={colDragDirection}
            anyColDragging={draggingColId !== null}
            onDragOverCard={cardId => { if (draggingColId === null) setDragOverCardId(cardId) }}
            dragOverCardId={dragOverCardId}
            onColumnDragStart={setDraggingColId}
            onColumnDrop={(e, targetColId) => {
              const draggedColId = Number(e.dataTransfer.getData('columnId'))
              setDraggingColId(null)
              setColDragOverId(null)
              moveColumn(draggedColId, targetColId)
            }}
            onColumnDragEnd={() => { setDraggingColId(null); setColDragOverId(null) }}
            onOpenDetail={card => setDetailCard(card)}
            searchQuery={searchQuery.trim()}
            caseSensitive={caseSensitive}
            wholeWord={wholeWord}
            onCardRef={registerCardRef}
            activeMatchCardId={activeMatchCardId}
          />
          )
        })}
        <button className="add-column-btn" onClick={addColumn}>
          <span>+</span> Add column
        </button>
        {columnLimitError && (
          <p style={{ color: 'red', alignSelf: 'flex-end', margin: '0 0 8px 8px', fontSize: '0.9rem' }}>
            Maximum of 10 columns reached
          </p>
        )}
      </main>
      </div>

      <AiAssistant
        boardId={boardId}
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onBoardChanged={loadBoard}
      />
    </div>
  )
}
