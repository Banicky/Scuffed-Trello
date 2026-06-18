import { useEffect, useRef } from 'react'

// Full-screen "portal iris" that plays while a board loads, then dissolves to
// reveal it. Tinted by the board's own colour. Falls back to a quick fade for
// anyone who prefers reduced motion.
export default function PortalTransition({ color, onDone }) {
  const doneRef = useRef(false)
  const finish = () => { if (!doneRef.current) { doneRef.current = true; onDone() } }

  // Remove precisely when the animation ends; keep a generous fallback timer
  // in case the animationend event is missed.
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t = setTimeout(finish, reduced ? 500 : 1700)
    return () => clearTimeout(t)
  }, [])

  function handleAnimationEnd(e) {
    if (e.animationName === 'portal-open' || e.animationName === 'portal-fade') finish()
  }

  return (
    <div
      className="portal"
      style={{ '--portal-color': color }}
      onAnimationEnd={handleAnimationEnd}
      aria-hidden="true"
    >
      <div className="portal-ring" />
    </div>
  )
}
