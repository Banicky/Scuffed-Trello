const API = 'http://localhost:4000'

export const API_BASE = API

// Turn a stored "/uploads/..." path into a full URL the browser can load
export function assetUrl(path) {
  if (!path) return ''
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

// Upload an image file via multipart/form-data; returns the stored URL path
export async function uploadImage(file) {
  const form = new FormData()
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
