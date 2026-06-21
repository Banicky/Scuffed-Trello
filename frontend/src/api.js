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
