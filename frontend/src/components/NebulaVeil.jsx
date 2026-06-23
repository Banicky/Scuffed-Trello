// Day-sky nebula texture. A static SVG painted *under* the Starfield canvas so
// the constellations + stars (drawn on the canvas above) stay fully legible.
//
// Tones of scattered puffs: blue gas across most of the sky, light cool-gray
// dust in the gaps, and a few bright near-white highlights that blend into the
// blue. Each puff starts as a radial bloom, then a
// filter displaces *and* noise-carves it into a structured cloud SHAPE —
// billowing lobes with concave, broken edges, not a smooth blob — while the
// bright core keeps it reading as a lit cloud. Gray is painted *after* blue, so
// where the two meet the dust threads over the gas (a muted blue-grey
// transition). Overlaps composite source-over → colour deepens at the seams.
// No animation: the canvas supplies the motion; the gas is a painted backdrop.

// cx/cy/hw/hh in the 1200×800 viewBox. `deep` picks the denser fill; `f` picks
// one of three displacement seeds so neighbouring puffs read as distinct forms.
const BLUE_PUFFS = [
  { cx: 120,  cy: 110, hw: 260, hh: 210, deep: true,  f: 'nbA' }, // top-left corner
  { cx: 540,  cy: 90,  hw: 250, hh: 185, deep: false, f: 'nbB' }, // top-centre
  { cx: 1000, cy: 120, hw: 280, hh: 205, deep: true,  f: 'nbC' }, // top-right
  { cx: 300,  cy: 330, hw: 240, hh: 200, deep: false, f: 'nbB' }, // upper-mid-left
  { cx: 760,  cy: 320, hw: 260, hh: 200, deep: true,  f: 'nbA' }, // upper-mid-centre
  { cx: 1150, cy: 380, hw: 220, hh: 220, deep: false, f: 'nbC' }, // right edge
  { cx: 60,   cy: 470, hw: 230, hh: 230, deep: false, f: 'nbA' }, // left edge
  { cx: 540,  cy: 540, hw: 270, hh: 210, deep: true,  f: 'nbB' }, // centre
  { cx: 980,  cy: 600, hw: 260, hh: 210, deep: false, f: 'nbC' }, // right-low
  { cx: 250,  cy: 690, hw: 250, hh: 205, deep: true,  f: 'nbA' }, // lower-left
  { cx: 700,  cy: 770, hw: 270, hh: 185, deep: false, f: 'nbB' }, // bottom-centre
  { cx: 1120, cy: 760, hw: 240, hh: 195, deep: true,  f: 'nbC' }, // bottom-right
]

// Gray dust — sparse now (~15%), a few light puffs tucked into the gaps between
// the blue, with a little overlap so the two tones blend rather than tile.
const GRAY_PUFFS = [
  { cx: 850,  cy: 230, hw: 205, hh: 175, deep: false, f: 'nbB' }, // upper gap (centre↔right)
  { cx: 470,  cy: 470, hw: 210, hh: 180, deep: true,  f: 'nbA' }, // centre-left gap
  { cx: 430,  cy: 800, hw: 220, hh: 170, deep: true,  f: 'nbC' }, // lower gap
  { cx: 820,  cy: 665, hw: 195, hh: 170, deep: false, f: 'nbA' }, // centre↔right-low
]

const FILTERS = [
  { id: 'nbA', seed: 7,  freq: '0.006 0.008',   scale: 56 },
  { id: 'nbB', seed: 19, freq: '0.0072 0.009',  scale: 48 },
  { id: 'nbC', seed: 33, freq: '0.0055 0.0072', scale: 62 },
]

// A few bright near-white highlight puffs, painted last (on top) so they blend
// into the blue gas as occasional sunlit lobes rather than tiling beside it.
const WHITE_PUFFS = [
  { cx: 360,  cy: 180, hw: 185, hh: 150, deep: false, f: 'nbC' }, // upper-left highlight
  { cx: 1080, cy: 235, hw: 175, hh: 145, deep: false, f: 'nbB' }, // top-right highlight
  { cx: 880,  cy: 430, hw: 205, hh: 165, deep: false, f: 'nbA' }, // mid-right highlight
  { cx: 600,  cy: 660, hw: 195, hh: 150, deep: false, f: 'nbB' }, // lower-centre highlight
]

// flatten to one render pass: blue under, gray mid, white highlights on top
const ALL_PUFFS = [
  ...BLUE_PUFFS.map(p => ({ ...p, tone: 'blue' })),
  ...GRAY_PUFFS.map(p => ({ ...p, tone: 'gray' })),
  ...WHITE_PUFFS.map(p => ({ ...p, tone: 'white' })),
]

function fillFor(p) {
  if (p.tone === 'white') return 'nbPuffWhite'
  if (p.tone === 'gray') return p.deep ? 'nbPuffGrayDeep' : 'nbPuffGray'
  return p.deep ? 'nbPuffDeep' : 'nbPuff'
}
function opacityFor(p) {
  if (p.tone === 'white') return 0.62
  if (p.tone === 'gray') return p.deep ? 0.55 : 0.42
  return p.deep ? 1 : 0.92
}

export default function NebulaVeil() {
  return (
    <svg
      className="nebula-veil"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        {/* blue gas — soft baby-blue puffs that fade out through a pale edge.
            Cores stay light so the white highlight puffs blend cleanly, and the
            mids hold a gentle baby blue rather than a rich, saturated azure. */}
        <radialGradient id="nbPuff" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#CDE8F8" stopOpacity="0.94" />
          <stop offset="50%" stopColor="#A7D7F1" stopOpacity="0.82" />
          <stop offset="100%" stopColor="#DCEFF8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="nbPuffDeep" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#8FCDEE" stopOpacity="1" />
          <stop offset="54%" stopColor="#ABDAF2" stopOpacity="0.88" />
          <stop offset="100%" stopColor="#DCEFF8" stopOpacity="0" />
        </radialGradient>

        {/* cool-slate dust — a faint blue-grey, kept very light so it adds quiet
            depth in the gaps without muddying the clean powder-blue clouds */}
        <radialGradient id="nbPuffGray" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#C6D4E4" stopOpacity="0.5" />
          <stop offset="50%" stopColor="#CFDAE8" stopOpacity="0.36" />
          <stop offset="100%" stopColor="#DEE6EF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="nbPuffGrayDeep" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#B6C7DC" stopOpacity="0.6" />
          <stop offset="54%" stopColor="#C7D5E6" stopOpacity="0.46" />
          <stop offset="100%" stopColor="#DEE6EF" stopOpacity="0" />
        </radialGradient>

        {/* bright near-white highlight — a soft sunlit core that blends into the
            blue gas where the two overlap, then fades clear */}
        <radialGradient id="nbPuffWhite" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.88" />
          <stop offset="48%" stopColor="#F1F7FD" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#EAF3FB" stopOpacity="0" />
        </radialGradient>

        {/* turn each round bloom into an organic cloud SHAPE with soft edges:
            (1) feDisplacementMap warps the outline so no two puffs match, then
            (2) feColorMatrix maps the noise red→alpha and feComposite carves it
                in *gently* — just enough to break the perfect oval into a cloud
                form without tearing it into broken lobes. A wider blur then
                feathers the whole edge so each shape stays soft, not crisp. */}
        {FILTERS.map(({ id, seed, freq, scale }) => (
          <filter key={id} id={id} x="-40%" y="-40%" width="180%" height="180%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency={freq} numOctaves="3" seed={seed} stitchTiles="stitch" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={scale} xChannelSelector="R" yChannelSelector="G" result="disp" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 -0.05" result="mask" />
            <feComposite in="disp" in2="mask" operator="in" result="shaped" />
            <feGaussianBlur in="shaped" stdDeviation="3.2" />
          </filter>
        ))}
      </defs>

      {/* scattered shaped puffs — blue gas under, grey dust over; overlaps deepen */}
      {ALL_PUFFS.map((p, i) => (
        <rect
          key={i}
          x={p.cx - p.hw}
          y={p.cy - p.hh}
          width={p.hw * 2}
          height={p.hh * 2}
          fill={`url(#${fillFor(p)})`}
          filter={`url(#${p.f})`}
          opacity={opacityFor(p)}
        />
      ))}
    </svg>
  )
}
