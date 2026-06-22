import { useEffect, useMemo, useRef, useState } from 'react'

// How many motes scatter across the screen. Kept sparse on purpose: enough to
// read as "matter reassembling," few enough to stay calm and easy to track —
// and each mote is its own compositor layer, so fewer of them = smoother.
const MOTE_COUNT = 16

// Keep the gather visible even when a board loads instantly, and never trap the
// user behind the veil if loading stalls or errors.
const MIN_HOLD = 280 // ms
const MAX_HOLD = 2400 // ms

// Build one batch of randomised motes. Each starts slightly off its resting
// spot (offset away from centre) and drifts gently inward as it fades, so the
// board reads as settling into place out of drifting dust.
function buildMotes() {
  return Array.from({ length: MOTE_COUNT }, () => {
    const x = Math.random() * 100 // vw
    const y = Math.random() * 100 // vh
    const drift = 14 + Math.random() * 26 // px travelled inward
    const dx = 50 - x
    const dy = 50 - y
    const len = Math.hypot(dx, dy) || 1
    return {
      x,
      y,
      size: 9 + Math.random() * 13, // px — soft glow is baked into the gradient
      mx: (dx / len) * drift,
      my: (dy / len) * drift,
      delay: Math.random() * 0.15, // s
      dur: 0.7 + Math.random() * 0.3, // s — one drift-and-settle cycle
      opacity: 0.45 + Math.random() * 0.4,
    }
  })
}

// Full-screen "teleport" that plays while a board loads. Two phases:
//   gather  — an opaque board-tinted veil with motes drifting inward, held
//             until the board has painted behind it (so its heavy first render
//             is never seen as a stutter);
//   reveal  — the veil fades away to show the finished board.
// Falls back to a quick fade for reduced motion.
export default function PortalTransition({ color, ready, onDone }) {
  const doneRef = useRef(false)
  const [mountedAt] = useState(() => Date.now())
  const [revealing, setRevealing] = useState(false)
  const finish = () => { if (!doneRef.current) { doneRef.current = true; onDone() } }

  const motes = useMemo(() => buildMotes(), [])
  // match the dashboard's day/night choice so the veil isn't a black flash in day
  const day = (localStorage.getItem('dash-color-mode') || 'night') === 'day'

  // Start the reveal once the board is ready (after a minimum hold so the
  // gather always reads), or force it after a hard cap as a safety net.
  useEffect(() => {
    if (revealing) return
    if (ready) {
      const wait = Math.max(0, MIN_HOLD - (Date.now() - mountedAt))
      const t = setTimeout(() => setRevealing(true), wait)
      return () => clearTimeout(t)
    }
    const cap = setTimeout(() => setRevealing(true), MAX_HOLD)
    return () => clearTimeout(cap)
  }, [ready, revealing, mountedAt])

  function handleAnimationEnd(e) {
    // Only the reveal fade ends the transition — the looping mote animations
    // bubble up here too and must not cut it short.
    if (e.animationName === 'portal-reveal' || e.animationName === 'portal-fade') finish()
  }

  return (
    <div
      className={`portal portal--settle${revealing ? ' portal--reveal' : ''}${day ? ' portal--day' : ''}`}
      style={{ '--portal-color': color }}
      onAnimationEnd={handleAnimationEnd}
      aria-hidden="true"
    >
      {motes.map((m, i) => (
        <span
          key={i}
          className="portal-mote"
          style={{
            left: `${m.x}vw`,
            top: `${m.y}vh`,
            '--size': `${m.size}px`,
            '--mx': `${m.mx}px`,
            '--my': `${m.my}px`,
            '--delay': `${m.delay}s`,
            '--dur': `${m.dur}s`,
            '--mote-opacity': m.opacity,
          }}
        />
      ))}
      <span className="portal-label">Journeying…</span>
    </div>
  )
}
