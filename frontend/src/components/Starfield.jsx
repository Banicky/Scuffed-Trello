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

// Daytime gas now comes from the watercolor sky image (assets/day-sky.png) set
// as the .dashboard-shell--day background — soft radial blooms here only read as
// a flat wash. The canvas keeps the day constellations, stars, motes, and
// shooting stars; the background image owns the clouds.
const NEBULAE_DAY = []

const STAR_TINTS_NIGHT = [
  [255, 255, 255],
  [216, 221, 232], // silver
  [200, 212, 230], // cool white-blue
  [191, 205, 224], // pale steel-blue
]

// Day stars are near-black ink with a faint navy cast, kept dark so they read
// crisply as black specks against the bright sky and white clouds. The depth
// layers give a natural range from soft grey dust to solid black points.
const STAR_TINTS_DAY = [
  [20, 25, 36],    // near-black ink
  [34, 41, 56],    // dark slate
  [26, 32, 47],    // deep ink-navy
  [14, 18, 28],    // black
]

// Faint background constellations — connected star-chains drawn across the
// whole sky for depth. Anchored in normalized space and scaled to viewport
// width; present in both modes, recoloured per sky (dark ink by day).
const CONSTELLATIONS = [
  { x: 0.06, y: 0.09, s: 0.13, pts: [[0, 0], [0.5, 0.7], [0.2, 1.5], [1.0, 1.7], [1.5, 1.0], [1.3, 0.2]] },
  { x: 0.25, y: 0.04, s: 0.09, pts: [[0, 0.3], [0.7, 0], [1.1, 0.8], [0.6, 1.2]] },
  { x: 0.64, y: 0.05, s: 0.11, pts: [[0, 0.6], [0.6, 0], [1.2, 0.5], [1.0, 1.3], [0.3, 1.4]] },
  { x: 0.89, y: 0.15, s: 0.13, pts: [[0, 0], [0.7, 0.4], [1.3, 0], [1.1, 0.9], [1.6, 1.4], [0.9, 1.5]] },
  { x: 0.15, y: 0.64, s: 0.12, pts: [[0, 0.2], [0.6, 0.6], [0.4, 1.3], [1.2, 1.2], [1.5, 0.5]] },
  { x: 0.40, y: 0.74, s: 0.09, pts: [[0, 0], [0.6, 0.5], [1.2, 0.2], [1.0, 1.0]] },
  { x: 0.85, y: 0.70, s: 0.11, pts: [[0, 0.2], [0.7, 0], [1.1, 0.7], [0.7, 1.3], [0.1, 1.1]] },
]

function rand(min, max) { return min + Math.random() * (max - min) }

export default function Starfield({ mode = 'night', randomConstellations = false }) {
  const canvasRef = useRef(null)
  const pointerRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Day vs night palette. Night stacks light additively over the void; day
    // paints dark ink specks normally so they read as black on the bright sky.
    const day = mode === 'day'
    const STAR_TINTS = day ? STAR_TINTS_DAY : STAR_TINTS_NIGHT
    const NEBULAE = day ? NEBULAE_DAY : NEBULAE_NIGHT
    const blend = day ? 'source-over' : 'lighter'
    const aBoost = day ? 1.65 : 1   // lift day stars so they read on the bright sky
    const trail = day ? [96, 116, 156] : [210, 220, 235]   // shooting-star tail tint
    const head = day ? [22, 28, 42] : [255, 255, 255]      // shooting-star head tint
    const constLine = day ? [30, 42, 66] : [188, 202, 226]  // constellation lines
    const constNode = day ? [14, 22, 40] : [224, 232, 246]  // constellation node stars
    const particleTint = day ? [150, 184, 226] : [202, 214, 234] // drifting motes
    // by day the constellations read crisp + defined against the bright sky;
    // by night they stay faint so they don't compete with the stars
    const constLineA = day ? 0.5 : 0.2
    const constNodeA = day ? 0.95 : 0.55
    const constWidth = day ? 1.0 : 0.8
    const constNodeR = day ? 1.7 : 1.4

    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2)
    let stars = []
    let particles = []
    let constellations = CONSTELLATIONS
    let shooting = []
    let raf = 0
    let t = 0
    let nextShoot = 1.5
    // While the user is actively scrolling any pane above the canvas, we skip
    // drawing and let the canvas hold its last frame. A repainting canvas
    // forces every backdrop-filter glass surface over it (sidebar, hero card,
    // topbar pills) to re-blur each frame — pausing during scroll hands that
    // whole budget back to the scroll. Holds ~160ms past the last scroll event.
    let scrollHoldUntil = 0

    // Pre-rendered sprites: the nebula blobs and mote glow are radial
    // gradients that never change shape or tint — only position and alpha.
    // Rendering them once and drawImage-ing per frame replaces the 21
    // createRadialGradient allocations + large gradient fills every frame.
    let nebulaSprites = []
    let particleSprite = null

    function makeNebulaSprites() {
      const md = Math.max(w, h)
      nebulaSprites = NEBULAE.map(n => {
        const rr = n.r * md
        // low-res sprite upscaled at draw time — a smooth radial gradient at
        // alpha ≤0.07 shows no visible banding, and this keeps memory tiny
        const size = 256
        const c = document.createElement('canvas')
        c.width = c.height = size
        const g2 = c.getContext('2d')
        const grad = g2.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
        const [r, gr, b] = n.color
        grad.addColorStop(0, `rgba(${r},${gr},${b},${n.a})`)
        grad.addColorStop(1, `rgba(${r},${gr},${b},0)`)
        g2.fillStyle = grad
        g2.fillRect(0, 0, size, size)
        return { canvas: c, rr }
      })
    }

    function makeParticleSprite() {
      const size = 64
      const c = document.createElement('canvas')
      c.width = c.height = size
      const g2 = c.getContext('2d')
      const [pr, pg, pb] = particleTint
      const grad = g2.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
      grad.addColorStop(0, `rgba(${pr},${pg},${pb},1)`)
      grad.addColorStop(1, `rgba(${pr},${pg},${pb},0)`)
      g2.fillStyle = grad
      g2.fillRect(0, 0, size, size)
      return c
    }
    particleSprite = makeParticleSprite()

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
      // faint cosmic motes — larger, soft, slow-drifting glows with parallax
      particles = []
      for (let i = 0; i < 18; i++) {
        particles.push({
          x: Math.random(),
          y: Math.random(),
          r: rand(2.2, 5.5),
          baseA: rand(0.04, 0.12),
          depth: rand(0.2, 0.7),
          vx: rand(-0.004, 0.004),
          vy: rand(-0.009, -0.003), // gentle upward drift
          phase: Math.random() * Math.PI * 2,
        })
      }
      // Constellations: the fixed star-chart by default. When asked (e.g. the
      // auth page) we re-roll their placement + shape each build so the chains
      // differ on every page load rather than sitting in the same spots.
      // Placement uses rejection sampling on pixel bounding boxes so the chains
      // never overlap — non-overlapping boxes guarantee no line from one chain
      // crosses another. Boxes are computed in pixels (parallax/drift ignored)
      // since x scales by w and the shape by w too, while y scales by h.
      if (randomConstellations) {
        const shapes = CONSTELLATIONS.map(c => c.pts)
        const n = 5 + Math.floor(Math.random() * 3) // 5–7 chains
        const pad = 0.02 * w // keep a little air between neighbouring chains
        const placed = [] // pixel boxes {l,t,r,b}
        constellations = []
        for (let k = 0; k < n; k++) {
          const pts = shapes[Math.floor(Math.random() * shapes.length)]
          // shape extents in shape-space (pre-scale)
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
          for (const pt of pts) {
            if (pt[0] < minX) minX = pt[0]
            if (pt[0] > maxX) maxX = pt[0]
            if (pt[1] < minY) minY = pt[1]
            if (pt[1] > maxY) maxY = pt[1]
          }
          let chain = null
          for (let attempt = 0; attempt < 40; attempt++) {
            const s = rand(0.08, 0.15)
            const sPx = s * w
            const bw = (maxX - minX) * sPx
            const bh = (maxY - minY) * sPx
            // pick a top-left so the whole box stays on-screen
            const lMax = w - bw - pad, tMax = h - bh - pad
            if (lMax <= pad || tMax <= pad) continue // box too big for this roll
            const l = rand(pad, lMax)
            const t = rand(pad, tMax)
            const box = { l: l - pad, t: t - pad, r: l + bw + pad, b: t + bh + pad }
            const hits = placed.some(b => !(box.r < b.l || box.l > b.r || box.b < b.t || box.t > b.b))
            if (hits) continue
            placed.push(box)
            // convert box top-left back to the chain origin (anchor) the draw expects
            chain = {
              x: (l - minX * sPx) / w,
              y: (t - minY * sPx) / h,
              s,
              pts,
            }
            break
          }
          if (chain) constellations.push(chain)
        }
      } else {
        constellations = CONSTELLATIONS
      }
    }

    function resize() {
      w = canvas.clientWidth
      h = canvas.clientHeight
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      makeNebulaSprites() // blob radius tracks the viewport size
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

    function drawNebulae(time) {
      for (let i = 0; i < nebulaSprites.length; i++) {
        const n = NEBULAE[i]
        const { canvas: img, rr } = nebulaSprites[i]
        // slow organic drift so the cloud breathes instead of sitting static
        const cx = n.x * w + Math.sin(time * 0.035 + i * 1.3) * 9
        const cy = n.y * h + Math.cos(time * 0.027 + i * 0.7) * 7
        ctx.drawImage(img, cx - rr, cy - rr, rr * 2, rr * 2)
      }
    }

    function drawConstellations(time, p) {
      const [lr, lg, lb] = constLine
      const [nr, ng, nb] = constNode
      constellations.forEach((c, i) => {
        const breath = 0.66 + 0.34 * Math.sin(time * 0.32 + i * 1.7)
        const sPx = c.s * w
        const ox = p.x * 14 + Math.sin(time * 0.04 + i) * 3 // slow far parallax + drift
        const oy = p.y * 14
        const cx = c.x * w + ox, cy = c.y * h + oy
        ctx.beginPath()
        c.pts.forEach((pt, j) => {
          const px = cx + pt[0] * sPx, py = cy + pt[1] * sPx
          if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
        })
        ctx.strokeStyle = `rgba(${lr},${lg},${lb},${constLineA * breath})`
        ctx.lineWidth = constWidth
        ctx.stroke()
        for (const pt of c.pts) {
          const px = cx + pt[0] * sPx, py = cy + pt[1] * sPx
          ctx.beginPath()
          ctx.fillStyle = `rgba(${nr},${ng},${nb},${constNodeA * breath})`
          ctx.arc(px, py, constNodeR, 0, Math.PI * 2)
          ctx.fill()
        }
      })
    }

    function drawParticles(dt, time, p) {
      for (const q of particles) {
        q.x += q.vx * dt
        q.y += q.vy * dt
        if (q.y < -0.05) q.y = 1.05
        if (q.x < -0.05) q.x = 1.05
        else if (q.x > 1.05) q.x = -0.05
        const px = q.x * w + p.x * q.depth * 30
        const py = q.y * h + p.y * q.depth * 30
        // globalAlpha scales the sprite's full-alpha gradient down to `a` —
        // the same falloff the old per-frame createRadialGradient produced
        ctx.globalAlpha = q.baseA * (0.7 + 0.3 * Math.sin(time * 0.5 + q.phase))
        ctx.drawImage(particleSprite, px - q.r, py - q.r, q.r * 2, q.r * 2)
      }
      ctx.globalAlpha = 1
    }

    function frame(now) {
      const time = now / 1000
      // scroll in progress: hold the last frame (no canvas invalidation, so
      // the glass panes above don't re-blur) and check again next frame. The
      // dt clamp below keeps motion continuous on resume — no catch-up jump.
      if (now < scrollHoldUntil) {
        t = time
        raf = requestAnimationFrame(frame)
        return
      }
      const dt = Math.min(time - t || 0.016, 0.05)
      t = time

      // ease pointer toward target
      const p = pointerRef.current
      p.x += (p.tx - p.x) * 0.06
      p.y += (p.ty - p.y) * 0.06

      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = blend
      drawNebulae(time)
      drawConstellations(time, p)

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

      drawParticles(dt, time, p)

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
      const p0 = { x: 0, y: 0 }
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = blend
      drawNebulae(0)
      drawConstellations(0, p0)
      for (const s of stars) {
        const [r, g, b] = s.tint
        ctx.beginPath()
        ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, s.baseA * aBoost)})`
        ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2)
        ctx.fill()
      }
      drawParticles(0, 0, p0)
      ctx.globalCompositeOperation = 'source-over'
    }

    function onPointer(e) {
      const nx = (e.clientX / window.innerWidth) * 2 - 1
      const ny = (e.clientY / window.innerHeight) * 2 - 1
      pointerRef.current.tx = nx
      pointerRef.current.ty = ny
    }

    function onResize() { resize(); build(); if (reduced) staticFrame() }

    // scroll events don't bubble, but capture on window catches the inner
    // scrollers (board grid, sidebar, popovers) that slide over the canvas
    function onScrollHold() { scrollHoldUntil = performance.now() + 160 }

    resize()
    build()
    if (reduced) {
      staticFrame()
    } else {
      window.addEventListener('pointermove', onPointer, { passive: true })
      window.addEventListener('scroll', onScrollHold, { capture: true, passive: true })
      raf = requestAnimationFrame(frame)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('scroll', onScrollHold, { capture: true })
    }
  }, [mode, randomConstellations])

  return <canvas ref={canvasRef} className="starfield-canvas" aria-hidden="true" />
}
