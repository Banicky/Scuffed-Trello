// Compact "time since" label, e.g. "3h ago". Returns null for empty input.
export function relativeTime(iso) {
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

// Build a RegExp for a search query, escaping regex metacharacters and
// optionally anchoring to whole words. Returns null if the pattern is invalid.
export function buildSearchRegex(query, { caseSensitive = false, wholeWord = false, flags = '' } = {}) {
  if (!query) return null
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = wholeWord ? `\\b${escaped}\\b` : escaped
  try {
    return new RegExp(pattern, caseSensitive ? flags : `${flags}i`)
  } catch {
    return null
  }
}

// Convert "#rrggbb" to an [r, g, b] tuple.
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
