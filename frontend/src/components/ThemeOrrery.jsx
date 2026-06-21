import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'

// A compact cosmic orrery that mirrors the dashboard hero art's GSAP format:
// a zodiac wheel, orbiting moons, twinkling sparkles, and a gentle GSAP float.
// `variant` swaps the central body — a tilted ringed planet (saturn) or a
// radiant sun — while `accent` tints the whole scene to match the theme.
export default function ThemeOrrery({ variant = 'planet', accent, idKey }) {
  const svgRef = useRef(null)

  useEffect(() => {
    // gentle vertical bob, identical easing/duration to the hero (.dash-hero-art-svg)
    const ctx = gsap.context(() => {
      gsap.to(svgRef.current, { y: -5, duration: 3.4, repeat: -1, yoyo: true, ease: 'sine.inOut' })
    }, svgRef)
    return () => ctx.revert()
  }, [])

  const planetGrad = `orreryPlanet-${idKey}`
  const glowGrad = `orreryGlow-${idKey}`
  const sunGrad = `orrerySun-${idKey}`

  return (
    <svg
      ref={svgRef}
      className="orrery-svg"
      viewBox="0 0 200 200"
      preserveAspectRatio="xMidYMid meet"
      style={{ '--orrery-accent': accent }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={planetGrad} cx="38%" cy="32%" r="78%">
          <stop offset="0%" stopColor={`color-mix(in srgb, ${accent} 26%, #f4f6fb)`} />
          <stop offset="52%" stopColor={`color-mix(in srgb, ${accent} 60%, #aab2c6)`} />
          <stop offset="100%" stopColor={`color-mix(in srgb, ${accent} 55%, #2a2e3a)`} />
        </radialGradient>
        <radialGradient id={glowGrad} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={`color-mix(in srgb, ${accent} 42%, transparent)`} />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <radialGradient id={sunGrad} cx="42%" cy="38%" r="72%">
          <stop offset="0%" stopColor={`color-mix(in srgb, ${accent} 14%, #fff7e6)`} />
          <stop offset="55%" stopColor={accent} />
          <stop offset="100%" stopColor={`color-mix(in srgb, ${accent} 62%, #5a2a00)`} />
        </radialGradient>
      </defs>

      {/* zodiac wheel */}
      <circle className="orrery-wheel" cx="100" cy="100" r="90" />
      <g className="orrery-ticks">
        {Array.from({ length: 12 }).map((_, i) => (
          <line key={i} className="orrery-tick" x1="100" y1="6" x2="100" y2="14" transform={`rotate(${i * 30} 100 100)`} />
        ))}
      </g>

      {/* central glow */}
      <circle className="orrery-glow" cx="100" cy="100" r="52" fill={`url(#${glowGrad})`} />

      {variant === 'sun' ? (
        // ── radiant sun ──
        <>
          <g className="orrery-rays">
            {Array.from({ length: 12 }).map((_, i) => (
              <line key={i} className="orrery-ray" x1="100" y1="71" x2="100" y2="59" transform={`rotate(${i * 30} 100 100)`} />
            ))}
          </g>
          <circle className="orrery-sun" cx="100" cy="100" r="22" fill={`url(#${sunGrad})`} />
        </>
      ) : (
        // ── tilted ringed planet (saturn) ──
        <g transform="rotate(-18 100 100)">
          <ellipse className="orrery-ring orrery-ring--back" cx="100" cy="100" rx="42" ry="13" />
          <circle cx="100" cy="100" r="21" fill={`url(#${planetGrad})`} />
          <path className="orrery-band" d="M82,95 q18,7 38,-2" />
          <path className="orrery-band" d="M81,104 q19,7 39,-1" />
          <path className="orrery-ring orrery-ring--front" d="M58,100 a42,13 0 0 0 84,0" />
        </g>
      )}

      {/* orbiting moons */}
      <g className="orrery-orbit orrery-orbit--a">
        <circle className="orrery-orbit-path" cx="100" cy="100" r="80" />
        <circle className="orrery-moon" cx="100" cy="20" r="3.4" />
      </g>
      <g className="orrery-orbit orrery-orbit--b">
        <circle className="orrery-orbit-path" cx="100" cy="100" r="62" />
        <circle className="orrery-moon orrery-moon--sm" cx="100" cy="38" r="2.4" />
      </g>

      {/* sparkles */}
      <path className="orrery-spark orrery-spark--1" d="M34,52 l1.4,4 4,1.4 -4,1.4 -1.4,4 -1.4,-4 -4,-1.4 4,-1.4 z" />
      <path className="orrery-spark orrery-spark--2" d="M168,140 l1.1,3.2 3.2,1.1 -3.2,1.1 -1.1,3.2 -1.1,-3.2 -3.2,-1.1 3.2,-1.1 z" />
      <path className="orrery-spark orrery-spark--3" d="M150,40 l0.9,2.6 2.6,0.9 -2.6,0.9 -0.9,2.6 -0.9,-2.6 -2.6,-0.9 2.6,-0.9 z" />
    </svg>
  )
}
