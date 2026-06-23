const API = 'http://localhost:4000'

export const API_BASE = API

// Turn a stored image reference into a URL the browser can load.
// Spaces objects are now PRIVATE, so a stored Spaces CDN URL can't be loaded
// directly — route it through the backend's auth-gated signed-URL proxy
// (/api/img/<key>), which checks the session and 302-redirects to a short-lived
// signed URL. Legacy local "/uploads/..." disk paths still load straight off the
// API. The proxy request carries the session cookie because it targets the API
// origin (ensure the session cookie is SameSite=None;Secure in cross-site prod).
export function assetUrl(path) {
  if (!path) return ''
  if (path.includes('digitaloceanspaces.com')) {
    try {
      const key = new URL(path).pathname.replace(/^\/+/, '')
      return `${API}/api/img/${key}`
    } catch {
      return ''
    }
  }
  return path.startsWith('http') ? path : `${API}${path}`
}

export async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  return res
}

// Fetch a board's exportable JSON document and trigger a browser download.
// The filename is derived from the board title (falls back to the id).
export async function exportBoard(boardId, boardTitle) {
  const res = await apiFetch(`/api/boards/${boardId}/export`)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Export failed')
  }
  const doc = await res.json()
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const safeName = (boardTitle || `board-${boardId}`).replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeName}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Replace a board's structure with an exported JSON document. Destructive on the
// backend — overwrites existing columns/cards.
export async function importBoard(boardId, doc) {
  const res = await apiFetch(`/api/boards/${boardId}/import`, {
    method: 'POST',
    body: JSON.stringify(doc),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Import failed')
  return data
}

// ── AI assistant (BYOK) ───────────────────────────────────────────────────────

// Whether the user has a key configured + their chosen model. Never returns the key.
export async function getAiKeyStatus() {
  const res = await apiFetch('/api/ai/key')
  if (!res.ok) throw new Error('Failed to load AI settings')
  return res.json() // { configured, model }
}

// Save/replace the key and/or model. Pass key:'' to clear it.
export async function saveAiKey({ key, model }) {
  const res = await apiFetch('/api/ai/key', { method: 'PUT', body: JSON.stringify({ key, model }) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to save')
  return data
}

// List the models the user's key has access to (for the settings dropdown).
export async function listAiModels() {
  const res = await apiFetch('/api/ai/models')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to list models')
  return data // [{ id, display_name }]
}

// One assistant turn. boardId optional (omit for the dashboard planning chat).
// history is prior [{ role, content }] turns. Returns { reply, applied, boardChanged }.
export async function aiChat({ boardId, message, history }) {
  const res = await apiFetch('/api/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ boardId, message, history }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'The assistant failed')
  return data
}

// Upload an image file via multipart/form-data; returns the stored URL path.
// type controls which uploads/<type>/ folder it lands in on the backend
// (avatars | cards | boards | comments) — must be appended before the file
// field since the backend reads it mid-stream while naming the object.
export async function uploadImage(file, type) {
  const form = new FormData()
  form.append('type', type)
  form.append('image', file)
  const res = await fetch(`${API}/api/upload`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Upload failed')
  }
  return res.json()
}
