// ═══════════════════════════════════════════════
//  GEOMETRÍA DEL TABLERO
// ═══════════════════════════════════════════════
// La app nació sin modelo del tablero: los poblados se cargaban como listas
// sueltas de { num, res }. Acá está la geometría que faltaba — hexágonos,
// vértices, aristas y puertos — para poder generar mapas, dibujarlos y, más
// adelante, reconocerlos desde una foto.
//
// Hexágonos "pointy-top" (punta arriba) ubicados por filas. Cada layout se
// describe con la cantidad de hexágonos por fila; de ahí sale todo lo demás.

export const R = 1;                    // radio (centro → vértice)
export const HEX_W = Math.sqrt(3) * R; // ancho de un hexágono
export const ROW_H = 1.5 * R;          // separación vertical entre filas

export const LAYOUTS = {
  // Tablero clásico: 19 hexágonos, hasta 4 jugadores.
  base: {
    id: "base",
    name: "Clásico",
    maxPlayers: 4,
    rows: [3, 4, 5, 4, 3],
    // 4 madera, 4 oveja, 4 trigo, 3 ladrillo, 3 mineral, 1 desierto
    terrains: { madera: 4, oveja: 4, trigo: 4, ladrillo: 3, mineral: 3, desierto: 1 },
    // 18 fichas: un 2 y un 12, dos de cada número restante
    numbers: [2, 12, ...[3, 4, 5, 6, 8, 9, 10, 11].flatMap(n => [n, n])],
    ports: ["3:1", "madera", "3:1", "ladrillo", "oveja", "3:1", "mineral", "trigo", "3:1"],
  },
  // Expansión 5-6 jugadores: 30 hexágonos.
  ext: {
    id: "ext",
    name: "Expansión 5-6",
    maxPlayers: 6,
    rows: [3, 4, 5, 6, 5, 4, 3],
    // 6 madera, 6 oveja, 6 trigo, 5 ladrillo, 5 mineral, 2 desierto
    terrains: { madera: 6, oveja: 6, trigo: 6, ladrillo: 5, mineral: 5, desierto: 2 },
    // 28 fichas: dos 2 y dos 12, tres de cada número restante
    numbers: [2, 2, 12, 12, ...[3, 4, 5, 6, 8, 9, 10, 11].flatMap(n => [n, n, n])],
    ports: ["3:1", "madera", "3:1", "ladrillo", "oveja", "3:1", "mineral", "trigo", "3:1", "oveja", "3:1"],
  },
};

export const layoutFor = (playerCount, expansion) =>
  (expansion || playerCount >= 5) ? LAYOUTS.ext : LAYOUTS.base;

const key = (x, y) => `${x.toFixed(3)},${y.toFixed(3)}`;

// Los 6 vértices de un hexágono pointy-top: uno arriba (90°) y cada 60°.
const cornersOf = (cx, cy) =>
  [0, 1, 2, 3, 4, 5].map(i => {
    const a = (Math.PI / 180) * (90 + 60 * i);
    return { x: cx + R * Math.cos(a), y: cy - R * Math.sin(a) };
  });

// Geometría de un layout: hexágonos con centro, vértices con posición y a qué
// hexágonos tocan, y las aristas del borde (para ubicar los puertos).
// Es determinística y no depende de qué mapa se generó, así que se cachea.
const cache = new Map();

export function geometry(layoutId) {
  if (cache.has(layoutId)) return cache.get(layoutId);
  const layout = LAYOUTS[layoutId];
  if (!layout) throw new Error(`layout desconocido: ${layoutId}`);

  const maxLen = Math.max(...layout.rows);
  const hexes = [];
  layout.rows.forEach((len, row) => {
    for (let col = 0; col < len; col++) {
      const cx = (col + (maxLen - len) / 2) * HEX_W + HEX_W / 2;
      const cy = row * ROW_H + R;
      hexes.push({ id: hexes.length, row, col, cx, cy });
    }
  });

  // Vértices: las esquinas compartidas por hexágonos vecinos son la misma.
  const vById = new Map();
  hexes.forEach(h => {
    h.corners = cornersOf(h.cx, h.cy).map(p => {
      const k = key(p.x, p.y);
      let v = vById.get(k);
      if (!v) { v = { id: `v${vById.size}`, x: p.x, y: p.y, hexes: [] }; vById.set(k, v); }
      if (!v.hexes.includes(h.id)) v.hexes.push(h.id);
      return v.id;
    });
  });
  const vertices = [...vById.values()];
  const vertexById = Object.fromEntries(vertices.map(v => [v.id, v]));

  // Aristas: cada par de vértices consecutivos de un hexágono. Las que
  // pertenecen a un solo hexágono son el borde de la isla — ahí van los puertos.
  const edges = new Map();
  hexes.forEach(h => {
    h.corners.forEach((a, i) => {
      const b = h.corners[(i + 1) % 6];
      const k = [a, b].sort().join("|");
      const e = edges.get(k) || { id: k, a: [a, b].sort()[0], b: [a, b].sort()[1], hexes: [] };
      e.hexes.push(h.id);
      edges.set(k, e);
    });
  });
  const allEdges = [...edges.values()];

  // Hexágonos vecinos: los que están a un ancho de distancia.
  hexes.forEach(h => {
    h.neighbors = hexes
      .filter(o => o.id !== h.id && Math.hypot(o.cx - h.cx, o.cy - h.cy) < HEX_W * 1.1)
      .map(o => o.id);
  });

  const cx = hexes.reduce((a, h) => a + h.cx, 0) / hexes.length;
  const cy = hexes.reduce((a, h) => a + h.cy, 0) / hexes.length;

  // Aristas del borde, ordenadas dando la vuelta a la isla, para poder repartir
  // los puertos parejos alrededor.
  const border = allEdges
    .filter(e => e.hexes.length === 1)
    .map(e => {
      const va = vertexById[e.a], vb = vertexById[e.b];
      const mx = (va.x + vb.x) / 2, my = (va.y + vb.y) / 2;
      return { ...e, mx, my, angle: Math.atan2(my - cy, mx - cx) };
    })
    .sort((p, q) => p.angle - q.angle);

  const width = Math.max(...vertices.map(v => v.x));
  const height = Math.max(...vertices.map(v => v.y));
  const geo = { layout, hexes, vertices, vertexById, edges: allEdges, border, center: { x: cx, y: cy }, width, height };
  cache.set(layoutId, geo);
  return geo;
}

// Vértices donde se juntan 3 hexágonos: los que definen si un poblado agarra
// tres números (y donde importa que no se junten los 6 y los 8).
export const innerVertices = geo => geo.vertices.filter(v => v.hexes.length === 3);

export const isRed = n => n === 6 || n === 8;

// ── Consultas sobre un mapa generado ──
// Sirven para que, al cargar los poblados, la app ofrezca solo lo que el
// tablero realmente tiene: si el 8 es madera y mineral, esos dos y nada más.

export const boardNumbers = board =>
  [...new Set(board.hexes.map(h => h.num).filter(Boolean))].sort((a, b) => a - b);

// Recursos que tienen ese número en el tablero, con cuántos hexágonos hay de
// cada uno, del más repetido al menos.
export function resourcesForNumber(board, num) {
  const n = Number(num);
  if (!board || !n) return [];
  const counts = {};
  board.hexes.forEach(h => { if (h.num === n) counts[h.res] = (counts[h.res] || 0) + 1; });
  return Object.entries(counts)
    .map(([res, count]) => ({ res, count }))
    .sort((a, b) => b.count - a.count || a.res.localeCompare(b.res));
}

// Hexágonos que toca un vértice, en el formato que usa el resto de la app
// ({ num, res }). El desierto no produce nada, así que no entra.
export function hexesForVertex(board, vertexId) {
  const geo = geometry(board.layout);
  const v = geo.vertexById[vertexId];
  if (!v) return [];
  return v.hexes
    .map(id => board.hexes[id])
    .filter(h => h && h.num && h.res !== "desierto")
    .map(h => ({ num: String(h.num), res: h.res }))
    .sort((a, b) => Number(b.num) - Number(a.num));
}

// Puerto que toca ese vértice, si hay alguno.
export function portForVertex(board, vertexId) {
  return board.ports.find(p => p.vertices.includes(vertexId)) || null;
}
