// ═══════════════════════════════════════════════
//  GENERADOR DE MAPAS
// ═══════════════════════════════════════════════
// Genera un tablero completo (terrenos, números, puertos y ladrón) para un
// layout, según el grado de dificultad elegido. Es puro y determinístico: con
// la misma semilla sale el mismo mapa, así se puede compartir y reproducir.

import { LAYOUTS, geometry, innerVertices, isRed } from "./geometry.js";
import { numberProb } from "../game/constants.js";

export const DIFFICULTIES = {
  oficial: {
    name: "Oficial",
    desc: "La distribución del reglamento: fichas en espiral desde una esquina.",
    onlyBase: true,
  },
  equilibrado: {
    name: "Equilibrado",
    desc: "Al azar pero parejo: sin 6 y 8 pegados, sin números repetidos vecinos y recursos balanceados.",
  },
  aleatorio: {
    name: "Aleatorio",
    desc: "Todo al azar, sin restricciones. Sale lo que sale.",
  },
  caotico: {
    name: "Caótico",
    desc: "Busca lo desparejo: números altos amontonados y recursos agrupados.",
  },
};

// Secuencia oficial de fichas del tablero clásico (letras A→R en espiral).
const OFFICIAL_TOKENS = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];

// ── Azar con semilla ──
export const randomSeed = () => Math.random().toString(36).slice(2, 8).toUpperCase();

const hashSeed = str => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

const rngFrom = seed => {
  let a = hashSeed(String(seed));
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffleWith = (rnd, arr) => {
  const b = [...arr];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
};

const terrainBag = layout =>
  Object.entries(layout.terrains).flatMap(([res, n]) => Array(n).fill(res));

// Orden en espiral desde la esquina superior izquierda hacia adentro: es el
// recorrido con el que el reglamento manda poner las fichas numeradas.
function spiralOrder(geo) {
  const pending = new Set(geo.hexes.map(h => h.id));
  const order = [];
  let ring = geo.hexes.filter(h => h.neighbors.length < 6);
  while (pending.size) {
    const outer = [...pending].map(id => geo.hexes[id]).filter(h =>
      h.neighbors.some(n => !pending.has(n)) || h.neighbors.length < 6);
    const layer = (outer.length ? outer : [...pending].map(id => geo.hexes[id]));
    const cx = geo.center.x, cy = geo.center.y;
    // Arranca arriba a la izquierda y gira en sentido horario.
    const sorted = layer
      .map(h => ({ h, a: Math.atan2(h.cy - cy, h.cx - cx) }))
      .sort((p, q) => p.a - q.a)
      .map(o => o.h);
    const start = sorted.findIndex(h => h.row === Math.min(...sorted.map(s => s.row)));
    const rotated = [...sorted.slice(start), ...sorted.slice(0, start)];
    rotated.forEach(h => { order.push(h.id); pending.delete(h.id); });
    ring = rotated;
  }
  return order;
}

// ── Métricas de balance ──

// Pips (puntos de probabilidad) por recurso: cuánta producción esperada hay de
// cada material en todo el tablero.
export function pipsByResource(board) {
  const out = {};
  board.hexes.forEach(h => {
    if (!h.num || h.res === "desierto") return;
    out[h.res] = (out[h.res] || 0) + numberProb(h.num);
  });
  return out;
}

// Cuántos pares de hexágonos vecinos son ambos 6 u 8, y cuántos comparten número.
export function adjacencyIssues(board, geo) {
  let reds = 0, repeats = 0;
  geo.hexes.forEach(h => {
    const a = board.hexes[h.id];
    h.neighbors.filter(n => n > h.id).forEach(n => {
      const b = board.hexes[n];
      if (!a.num || !b.num) return;
      if (isRed(a.num) && isRed(b.num)) reds++;
      if (a.num === b.num) repeats++;
    });
  });
  return { reds, repeats };
}

// Vértices (esquinas de 3 hexágonos) con más de dos fichas rojas: los puntos
// donde un solo poblado se lleva media partida.
export function hotVertices(board, geo) {
  return innerVertices(geo).filter(v =>
    v.hexes.filter(id => isRed(board.hexes[id].num)).length > 2).length;
}

const pipSpread = board => {
  const pips = Object.values(pipsByResource(board));
  return pips.length ? Math.max(...pips) - Math.min(...pips) : 0;
};

export function boardBalance(board) {
  const geo = geometry(board.layout);
  const { reds, repeats } = adjacencyIssues(board, geo);
  return { reds, repeats, hot: hotVertices(board, geo), pips: pipsByResource(board), spread: pipSpread(board) };
}

// En la expansión hay 30 hexágonos y 28 fichas: exigir cero números repetidos
// vecinos casi nunca se cumple (el tablero de la caja tampoco lo cumple), así
// que ahí se toleran hasta dos. Lo que no se negocia es 6/8 pegados.
const isBalanced = b => {
  const s = boardBalance(b);
  const maxRepeats = b.layout === "base" ? 0 : 2;
  return s.reds === 0 && s.hot === 0 && s.repeats <= maxRepeats && s.spread <= 4;
};

// Cuanto más alto, más desparejo (lo que busca el modo caótico).
const chaosScore = b => {
  const s = boardBalance(b);
  return s.reds * 3 + s.repeats + s.hot * 4 + s.spread;
};

// Reparte terrenos y fichas sobre el layout. Las fichas van en espiral salteando
// los desiertos, igual que en la caja.
function layTiles(geo, terrains, numbers) {
  const order = spiralOrder(geo);
  const hexes = geo.hexes.map((h, i) => ({ id: h.id, row: h.row, col: h.col, res: terrains[i], num: null }));
  let t = 0;
  order.forEach(id => { if (hexes[id].res !== "desierto") hexes[id].num = numbers[t++]; });
  return hexes;
}

// Puertos: repartidos parejos sobre las aristas del borde, cada uno ocupando
// dos vértices contiguos como en el tablero real.
// La ficha del puerto se corre hacia afuera para que quede en el agua y no
// tapada por el hexágono.
const PORT_OFFSET = 0.38;

export function layPorts(geo, types) {
  const border = geo.border;
  const step = border.length / types.length;
  return types.map((type, i) => {
    const e = border[Math.round(i * step) % border.length];
    const dx = e.mx - geo.center.x, dy = e.my - geo.center.y;
    const d = Math.hypot(dx, dy) || 1;
    return {
      type,
      vertices: [e.a, e.b],
      x: e.mx + (dx / d) * PORT_OFFSET,
      y: e.my + (dy / d) * PORT_OFFSET,
    };
  });
}

// Puertos en las posiciones de siempre y en el orden del reglamento. La foto no
// los reconoce (el marco del tablero físico es fijo), así que un tablero cargado
// por foto arranca con estos y se corrigen a mano si hace falta.
export const defaultPorts = layout => layPorts(geometry(layout), LAYOUTS[layout].ports);

/**
 * Genera un tablero.
 * @param {object} opts
 * @param {"base"|"ext"} opts.layout
 * @param {keyof DIFFICULTIES} opts.difficulty
 * @param {string} [opts.seed] — misma semilla ⇒ mismo mapa
 */
export function generateBoard({ layout = "base", difficulty = "equilibrado", seed = randomSeed() } = {}) {
  const def = LAYOUTS[layout];
  if (!def) throw new Error(`layout desconocido: ${layout}`);
  const geo = geometry(layout);
  const rnd = rngFrom(`${layout}:${difficulty}:${seed}`);
  // "Oficial" solo existe para el tablero clásico; en la expansión el
  // reglamento no trae una espiral equivalente, así que cae en equilibrado.
  const mode = (difficulty === "oficial" && def.id !== "base") ? "equilibrado" : difficulty;

  const build = () => {
    const terrains = shuffleWith(rnd, terrainBag(def));
    const numbers = mode === "oficial" ? OFFICIAL_TOKENS : shuffleWith(rnd, def.numbers);
    const hexes = layTiles(geo, terrains, numbers);
    const desert = hexes.find(h => h.res === "desierto");
    return {
      layout,
      difficulty,
      seed,
      hexes,
      ports: layPorts(geo, shuffleWith(rnd, def.ports)),
      robber: desert ? desert.id : null,
    };
  };

  if (mode === "oficial" || mode === "aleatorio") return build();

  if (mode === "caotico") {
    // Se queda con el más desparejo de un puñado de intentos.
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 60; i++) {
      const b = build(), s = chaosScore(b);
      if (s > bestScore) { best = b; bestScore = s; }
    }
    return best;
  }

  // Equilibrado: en vez de generar al azar y descartar (con 28 fichas casi
  // nunca sale de casualidad), coloca las fichas una por una eligiendo solo
  // entre las que no rompen ninguna regla, y reintenta si se traba.
  let bestPlaced = null, bestSpread = Infinity;
  for (let attempt = 0; attempt < 200; attempt++) {
    const base = build();
    const placed = placeBalanced(geo, base.hexes, def.numbers, rnd);
    if (!placed) continue;
    const candidate = { ...base, hexes: placed };
    const spread = pipSpread(candidate);
    if (spread <= 4) return candidate;
    // Los recursos quedaron desparejos, pero las fichas no rompen ninguna regla:
    // vale más guardarlo que volver al azar puro.
    if (spread < bestSpread) { bestPlaced = candidate; bestSpread = spread; }
  }
  if (bestPlaced) return bestPlaced;
  // Ni una colocación válida (no debería pasar): lo más parejo que salga al azar.
  let best = null, bestScore = Infinity;
  for (let i = 0; i < 200; i++) {
    const b = build(), s = chaosScore(b);
    if (s < bestScore) { best = b; bestScore = s; }
  }
  return best;
}

// Coloca las fichas numeradas en espiral, eligiendo en cada hexágono solo
// números que no queden pegados a otro igual ni junten dos rojos (6/8), y que
// no armen un vértice con tres rojos. Devuelve null si se traba.
function placeBalanced(geo, hexes, numbers, rnd) {
  const out = hexes.map(h => ({ ...h, num: null }));
  const order = spiralOrder(geo).filter(id => out[id].res !== "desierto");
  const bag = [...numbers];
  const vertsOf = {};
  innerVertices(geo).forEach(v => v.hexes.forEach(id => { (vertsOf[id] ||= []).push(v); }));

  for (const id of order) {
    const neighbors = geo.hexes[id].neighbors.map(n => out[n].num).filter(Boolean);
    const options = [...new Set(bag)].filter(n => {
      if (neighbors.includes(n)) return false;
      if (isRed(n) && neighbors.some(isRed)) return false;
      if (isRed(n) && (vertsOf[id] || []).some(v =>
        v.hexes.filter(o => o !== id && isRed(out[o].num)).length >= 2)) return false;
      return true;
    });
    if (!options.length) return null;
    const pick = options[Math.floor(rnd() * options.length)];
    out[id].num = pick;
    bag.splice(bag.indexOf(pick), 1);
  }
  return out;
}
