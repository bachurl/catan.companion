// ═══════════════════════════════════════════════
//  CONSTANTES DEL JUEGO
// ═══════════════════════════════════════════════
export const RES = [
  { id: "madera", n: "Madera", e: "🌲", bg: "bg-green-700", tx: "text-green-100" },
  { id: "ladrillo", n: "Ladrillo", e: "🧱", bg: "bg-red-700", tx: "text-red-100" },
  { id: "trigo", n: "Trigo", e: "🌾", bg: "bg-yellow-700", tx: "text-yellow-100" },
  { id: "oveja", n: "Oveja", e: "🐑", bg: "bg-lime-700", tx: "text-lime-100" },
  { id: "mineral", n: "Mineral", e: "⛰️", bg: "bg-stone-600", tx: "text-stone-100" },
];
export const RM = Object.fromEntries(RES.map(r => [r.id, r]));
export const NUMS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
export const COSTS = {
  camino: { madera: 1, ladrillo: 1 },
  poblado: { madera: 1, ladrillo: 1, trigo: 1, oveja: 1 },
  ciudad: { mineral: 3, trigo: 2 },
  desarrollo: { mineral: 1, trigo: 1, oveja: 1 },
};
export const COST_NAMES = { camino: "Camino", poblado: "Poblado", ciudad: "Ciudad", desarrollo: "Carta Desarrollo" };
export const COST_EMOJI = { camino: "🛤️", poblado: "🏠", ciudad: "🏙️", desarrollo: "🃏" };

export const INIT_DECK = [
  ...Array(14).fill("caballero"), ...Array(5).fill("victoria"),
  ...Array(2).fill("caminos"), ...Array(2).fill("abundancia"), ...Array(2).fill("monopolio"),
];
export const DC = {
  caballero: { n: "Caballero", e: "⚔️", d: "Mové el ladrón y robá 1 carta" },
  victoria: { n: "Punto de Victoria", e: "🏆", d: "+1 punto de victoria" },
  caminos: { n: "Construcción", e: "🛤️", d: "Construí 2 caminos gratis" },
  abundancia: { n: "Abundancia", e: "🎁", d: "Tomá 2 recursos del banco" },
  monopolio: { n: "Monopolio", e: "👑", d: "Todos te dan un recurso" },
};
export const COLORS = [
  { n: "Azul", h: "#3b82f6", ring: "ring-blue-400" },
  { n: "Rojo", h: "#ef4444", ring: "ring-red-400" },
  { n: "Blanco", h: "#e2e8f0", ring: "ring-slate-300" },
  { n: "Naranja", h: "#f97316", ring: "ring-orange-400" },
  { n: "Verde", h: "#22c55e", ring: "ring-green-400" },
  { n: "Violeta", h: "#a855f7", ring: "ring-purple-400" },
];

export const COLOR_EMOJI = ["🔵", "🔴", "⚪", "🟠", "🟢", "🟣"];
export const playerMark = (ci) => COLOR_EMOJI[ci] || "🔘";

// Game modes
// "full":   classic experience (enforce build costs, dev cards, etc.)
// "simple": manual dice entry + free-form building, used as a lightweight scorekeeper.
export const GAME_MODES = {
  full:   { enforceCosts: true,  manualDiceOnly: false, showDevCards: true  },
  simple: { enforceCosts: false, manualDiceOnly: true,  showDevCards: false },
};

// ═══════════════════════════════════════════════
//  UTILIDADES
// ═══════════════════════════════════════════════
export const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
export const rollDie = () => Math.floor(Math.random() * 6) + 1;
export const afford = (h, c) => Object.entries(c).every(([r, a]) => (h[r] || 0) >= a);
export const totalC = h => Object.values(h).reduce((a, b) => a + b, 0);
export const eHand = () => ({ madera: 0, ladrillo: 0, trigo: 0, oveja: 0, mineral: 0 });

export const numberProb = n => { const d = Math.abs(7 - n); return 6 - d; };
export const dotStr = n => "•".repeat(numberProb(n));
