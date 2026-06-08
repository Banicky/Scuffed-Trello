import { TAG_COLORS } from '../constants.js'

export default function Tag({ label, color }) {
  const style = TAG_COLORS[label] || { bg: 'rgba(99,102,241,0.12)', color: color || '#6366f1' }
  return (
    <span className="card-tag" style={{ background: style.bg, color: style.color }}>
      {label}
    </span>
  )
}
