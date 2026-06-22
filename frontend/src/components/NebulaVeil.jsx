// Day-sky nebula texture. A static SVG painted *under* the Starfield canvas so
// the constellations + stars (drawn on the canvas above) stay fully legible.
//
// Two tones of scattered puffs: blue gas (~70% of the sky) and light cool-gray
// dust (~15%), leaving ~15% open white. Each puff starts as a radial bloom, then a
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
  { id: 'nbA', seed: 7,  freq: '0.006 0.008',   scale: 62 },
  { id: 'nbB', seed: 19, freq: '0.0072 0.009',  scale: 52 },
  { id: 'nbC', seed: 33, freq: '0.0055 0.0072', scale: 70 },
]

// flatten to one render pass: blue first (painted under), gray second (on top)
const ALL_PUFFS = [
  ...BLUE_PUFFS.map(p => ({ ...p, tone: 'blue' })),
  ...GRAY_PUFFS.map(p => ({ ...p, tone: 'gray' })),
]

function fillFor(p) {
  if (p.tone === 'gray') return p.deep ? 'nbPuffGrayDeep' : 'nbPuffGray'
  return p.deep ? 'nbPuffDeep' : 'nbPuff'
}
function opacityFor(p) {
  if (p.tone === 'gray') return p.deep ? 0.95 : 0.85
  return p.deep ? 1 : 0.94
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
        {/* blue gas — saturated cores fading out through pale #DAE8F0 edges */}
        <radialGradient id="nbPuff" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#93C3E8" stopOpacity="0.96" />
          <stop offset="50%" stopColor="#B4D6EE" stopOpacity="0.76" />
          <stop offset="100%" stopColor="#DAE8F0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="nbPuffDeep" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#66A8DD" stopOpacity="1" />
          <stop offset="54%" stopColor="#97C6EA" stopOpacity="0.86" />
          <stop offset="100%" stopColor="#DAE8F0" stopOpacity="0" />
        </radialGradient>

        {/* cool-grey dust — lightened: paler cores fading to #DEE2E7 */}
        <radialGradient id="nbPuffGray" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#B6BFC9" stopOpacity="0.85" />
          <stop offset="50%" stopColor="#CCD2D9" stopOpacity="0.66" />
          <stop offset="100%" stopColor="#DEE2E7" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="nbPuffGrayDeep" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#9AA4B0" stopOpacity="0.95" />
          <stop offset="54%" stopColor="#C2C8D0" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#DEE2E7" stopOpacity="0" />
        </radialGradient>

        {/* turn each round bloom into a structured cloud SHAPE (not a blob):
            (1) feDisplacementMap warps the outline organically, then
            (2) feColorMatrix maps the noise red→alpha and feComposite carves
                that mask in — removing low-density regions splits the form into
                billowing lobes with concave, broken edges. The bright core
                survives, so it still reads as a lit cloud; a light blur smooths
                the tooth without flattening the lobes back into a blob. */}
        {FILTERS.map(({ id, seed, freq, scale }) => (
          <filter key={id} id={id} x="-40%" y="-40%" width="180%" height="180%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency={freq} numOctaves="3" seed={seed} stitchTiles="stitch" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={scale} xChannelSelector="R" yChannelSelector="G" result="disp" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 -0.14" result="mask" />
            <feComposite in="disp" in2="mask" operator="in" result="shaped" />
            <feGaussianBlur in="shaped" stdDeviation="1" />
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
