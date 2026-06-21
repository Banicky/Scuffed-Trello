import { useEffect, useRef } from 'react'

// Canvas 2D night sky: layered twinkling stars with depth parallax, drifting
// nebula haze, and the occasional shooting star. Sits behind the dashboard.
// Honors prefers-reduced-motion by drawing a single static frame.

const STAR_LAYERS = [
  { count: 90, depth: 0.18, size: [0.4, 1.0], alpha: [0.18, 0.5] },  // far dust
  { count: 55, depth: 0.42, size: [0.7, 1.6], alpha: [0.35, 0.8] },  // mid
  { count: 26, depth: 0.85, size: [1.1, 2.4], alpha: [0.55, 1.0] },  // near, bright
]

const NEBULAE_NIGHT = [
  { x: 0.18, y: 0.10, r: 0.44, color: [70, 84, 110], a: 0.07 },   // cold slate, top-left
  { x: 0.86, y: 0.04, r: 0.36, color: [58, 70, 96],  a: 0.06 },   // steel, top-right
  { x: 0.7,  y: 0.94, r: 0.52, color: [60, 92, 110], a: 0.045 },  // faint teal, bottom
]

// Daytime haze: warm amber clouds, painted normally (not additively) so they
// settle softly onto the light sky instead of blowing out to white.
const NEBULAE_DAY = [
  { x: 0.20, y: 0.08, r: 0.50, color: [232, 196, 130], a: 0.12 }, // warm gold, top-left
  { x: 0.84, y: 0.04, r: 0.40, color: [240, 200, 138], a: 0.10 }, // sun haze, top-right
  { x: 0.7,  y: 0.96, r: 0.55, color: [214, 178, 128], a: 0.10 }, // sand, bottom
]

const STAR_TINTS_NIGHT = [
  [255, 255, 255],
  [216, 221, 232], // silver
  [200, 212, 230], // cool white-blue
  [191, 205, 224], // pale steel-blue
]

// Day stars are warm bronze, kept deliberately darker than the sky so they
// stay legible even over the lightest, warmest part of the gradient (the
// bottom) where a brighter gold would simply vanish. source-over blended.
const STAR_TINTS_DAY = [
  [150, 104, 36],  // bronze
  [132, 92, 40],   // deep bronze
  [176, 126, 54],  // amber
  [118, 82, 34],   // umber
]

function rand(min, max) { return min + Math.random() * (max - min) }

export default function Starfield({ mode = 'night' }) {
  const canvasRef = useRef(null)
  const pointerRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Day vs night palette. Night stacks light additively over the void; day
    // paints warm specks normally so they stay visible on the bright sky.
    const day = mode === 'day'
    const STAR_TINTS = day ? STAR_TINTS_DAY : STAR_TINTS_NIGHT
    const NEBULAE = day ? NEBULAE_DAY : NEBULAE_NIGHT
    const blend = day ? 'source-over' : 'lighter'
    const aBoost = day ? 1.65 : 1   // lift day stars so they read on the bright sky
    const trail = day ? [196, 150, 70] : [210, 220, 235]   // shooting-star tail tint
    const head = day ? [120, 84, 30] : [255, 255, 255]     // shooting-star head tint

    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2)
    let stars = []
    let shooting = []
    let raf = 0
    let t = 0
    let nextShoot = 1.5

    function build() {
      stars = []
      for (const layer of STAR_LAYERS) {
        for (let i = 0; i < layer.count; i++) {
          stars.push({
            x: Math.random(),
            y: Math.random(),
            depth: layer.depth,
            r: rand(layer.size[0], layer.size[1]),
            baseA: rand(layer.alpha[0], layer.alpha[1]),
            tint: STAR_TINTS[Math.random() < 0.78 ? (Math.random() < 0.6 ? 0 : 1) : (Math.random() < 0.6 ? 2 : 3)],
            phase: Math.random() * Math.PI * 2,
            speed: rand(0.6, 1.8),
          })
        }
      }
    }

    function resize() {
      w = canvas.clientWidth
      h = canvas.clientHeight
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    function spawnShoot() {
      const fromLeft = Math.random() < 0.5
      const y = rand(0.04, 0.42) * h
      const angle = rand(0.32, 0.5) // radians, gentle downward
      const speed = rand(620, 880)
      const dir = fromLeft ? 1 : -1
      shooting.push({
        x: fromLeft ? -40 : w + 40,
        y,
        vx: Math.cos(angle) * speed * dir,
        vy: Math.sin(angle) * speed,
        life: 0,
        max: rand(0.7, 1.1),
        len: rand(120, 210),
      })
    }

    function drawNebulae() {
      for (const n of NEBULAE) {
        const cx = n.x * w, cy = n.y * h, rr = n.r * Math.max(w, h)
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr)
        const [r, gr, b] = n.color
        g.addColorStop(0, `rgba(${r},${gr},${b},${n.a})`)
        g.addColorStop(1, `rgba(${r},${gr},${b},0)`)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      }
    }

    function frame(now) {
      const time = now / 1000
      const dt = Math.min(time - t || 0.016, 0.05)
      t = time

      // ease pointer toward target
      const p = pointerRef.current
      p.x += (p.tx - p.x) * 0.06
      p.y += (p.ty - p.y) * 0.06

      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = blend
      drawNebulae()

      // stars
      for (const s of stars) {
        const twinkle = 0.6 + 0.4 * Math.sin(time * s.speed + s.phase)
        const a = Math.min(1, s.baseA * twinkle * aBoost)
        const px = s.x * w + p.x * s.depth * 26 + Math.sin(time * 0.05 + s.phase) * s.depth * 6
        const py = s.y * h + p.y * s.depth * 26
        const [r, g, b] = s.tint
        ctx.beginPath()
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`
        ctx.arc(px, py, s.r, 0, Math.PI * 2)
        ctx.fill()
        // glow for the brightest near stars
        if (s.depth > 0.8 && s.r > 1.7) {
          ctx.beginPath()
          ctx.fillStyle = `rgba(${r},${g},${b},${a * 0.12})`
          ctx.arc(px, py, s.r * 3.2, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // shooting stars
      nextShoot -= dt
      if (nextShoot <= 0) { spawnShoot(); nextShoot = rand(3.5, 8) }
      for (let i = shooting.length - 1; i >= 0; i--) {
        const sh = shooting[i]
        sh.life += dt
        sh.x += sh.vx * dt
        sh.y += sh.vy * dt
        const k = 1 - sh.life / sh.max
        if (k <= 0 || sh.x < -120 || sh.x > w + 120 || sh.y > h + 120) { shooting.splice(i, 1); continue }
        const mag = Math.hypot(sh.vx, sh.vy)
        const ux = sh.vx / mag, uy = sh.vy / mag
        const tailX = sh.x - ux * sh.len, tailY = sh.y - uy * sh.len
        const grad = ctx.createLinearGradient(sh.x, sh.y, tailX, tailY)
        grad.addColorStop(0, `rgba(${head[0]},${head[1]},${head[2]},${0.9 * k})`)
        grad.addColorStop(0.4, `rgba(${trail[0]},${trail[1]},${trail[2]},${0.35 * k})`)
        grad.addColorStop(1, `rgba(${trail[0]},${trail[1]},${trail[2]},0)`)
        ctx.strokeStyle = grad
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(sh.x, sh.y)
        ctx.lineTo(tailX, tailY)
        ctx.stroke()
        ctx.beginPath()
        ctx.fillStyle = `rgba(${head[0]},${head[1]},${head[2]},${k})`
        ctx.arc(sh.x, sh.y, 1.8, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.globalCompositeOperation = 'source-over'
      raf = requestAnimationFrame(frame)
    }

    function staticFrame() {
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = blend
      drawNebulae()
      for (const s of stars) {
        const [r, g, b] = s.tint
        ctx.beginPath()
        ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, s.baseA * aBoost)})`
        ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
    }

    function onPointer(e) {
      const nx = (e.clientX / window.innerWidth) * 2 - 1
      const ny = (e.clientY / window.innerHeight) * 2 - 1
      pointerRef.current.tx = nx
      pointerRef.current.ty = ny
    }

    function onResize() { resize(); build(); if (reduced) staticFrame() }

    resize()
    build()
    if (reduced) {
      staticFrame()
    } else {
      window.addEventListener('pointermove', onPointer, { passive: true })
      raf = requestAnimationFrame(frame)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onPointer)
    }
  }, [mode])

  return <canvas ref={canvasRef} className="starfield-canvas" aria-hidden="true" />
}
