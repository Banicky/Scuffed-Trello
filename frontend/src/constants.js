export const COLUMN_PALETTE = [
  '#6b7280',
  '#f59e0b',
  '#8b5cf6',
  '#10b981',
  '#3b82f6',
  '#ec4899',
  '#ef4444',
  '#14b8a6',
]

// Stylized star-point constellations for the 12 zodiac signs, in a 0-100
// viewBox. Decorative, not astronomically accurate — each is an ordered
// path of stars connected by lines.
export const ZODIAC_CONSTELLATIONS = [
  { name: 'Aries',       points: [[12,55],[28,32],[46,40],[64,24],[82,38]] },
  { name: 'Taurus',      points: [[10,30],[26,48],[40,30],[58,46],[74,32],[90,50]] },
  { name: 'Gemini',      points: [[16,15],[16,55],[34,75],[66,75],[84,55],[84,15]] },
  { name: 'Cancer',      points: [[18,50],[36,30],[54,50],[36,70],[18,50]] },
  { name: 'Leo',         points: [[10,62],[26,36],[48,24],[64,40],[86,18],[96,44],[64,40]] },
  { name: 'Virgo',       points: [[8,20],[24,42],[20,68],[42,82],[60,62],[54,38],[72,28],[90,46]] },
  { name: 'Libra',       points: [[12,50],[34,18],[50,50],[66,18],[88,50]] },
  { name: 'Scorpio',     points: [[6,18],[20,38],[36,30],[50,48],[64,66],[80,80],[90,62]] },
  { name: 'Sagittarius', points: [[10,80],[40,50],[70,20],[58,30],[80,10],[70,42]] },
  { name: 'Capricorn',   points: [[10,28],[28,52],[50,40],[68,64],[60,84],[88,68]] },
  { name: 'Aquarius',    points: [[6,40],[20,24],[34,40],[48,24],[62,40],[76,24],[90,40]] },
  { name: 'Pisces',      points: [[12,18],[28,42],[14,66],[34,80],[58,52],[82,70],[96,46],[78,28]] },
]
