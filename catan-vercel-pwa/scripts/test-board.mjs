// Tests de la geometría y del generador de mapas.
// Correr con: npm run test:board
import { geometry, LAYOUTS, layoutFor, innerVertices, isRed, hexesForVertex, portForVertex, resourcesForNumber } from "../src/board/geometry.js";
import { generateBoard, boardBalance, pipsByResource } from "../src/board/generate.js";
import { numberProb } from "../src/game/constants.js";

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

console.log("GEOMETRÍA:");
const base = geometry("base");
assert(base.hexes.length === 19, "clásico: 19 hexágonos");
assert(base.vertices.length === 54, "clásico: 54 vértices");
assert(base.edges.length === 72, "clásico: 72 aristas");
assert(innerVertices(base).length === 24, "clásico: 24 esquinas de tres hexágonos");
assert(base.hexes.every(h => h.corners.length === 6), "cada hexágono tiene 6 esquinas");
assert(base.hexes.filter(h => h.neighbors.length === 6).length === 7, "clásico: 7 hexágonos interiores");
const ext = geometry("ext");
assert(ext.hexes.length === 30, "expansión: 30 hexágonos");
assert(layoutFor(4).id === "base" && layoutFor(5).id === "ext" && layoutFor(4, true).id === "ext",
  "el layout sale de la cantidad de jugadores");

console.log("\nPIEZAS:");
for (const l of Object.values(LAYOUTS)) {
  const total = Object.values(l.terrains).reduce((a, b) => a + b, 0);
  assert(total === l.rows.reduce((a, b) => a + b, 0), `${l.id}: los terrenos llenan el tablero`);
  assert(l.numbers.length === total - l.terrains.desierto, `${l.id}: hay una ficha por hexágono sin desierto`);
  assert(!l.numbers.includes(7), `${l.id}: no hay ficha del 7`);
}

console.log("\nGENERADOR:");
for (const layout of ["base", "ext"]) {
  const def = LAYOUTS[layout];
  for (const difficulty of ["oficial", "equilibrado", "aleatorio", "caotico"]) {
    const b = generateBoard({ layout, difficulty, seed: "TEST01" });
    const label = `${layout}/${difficulty}`;
    const numbered = b.hexes.filter(h => h.num);
    const counts = {};
    b.hexes.forEach(h => { counts[h.res] = (counts[h.res] || 0) + 1; });
    assert(b.hexes.length === def.rows.reduce((a, x) => a + x, 0), `${label}: cantidad de hexágonos`);
    assert(Object.entries(def.terrains).every(([r, n]) => counts[r] === n), `${label}: terrenos exactos`);
    assert(numbered.length === def.numbers.length, `${label}: todas las fichas puestas`);
    assert(b.hexes.every(h => (h.res === "desierto") === !h.num), `${label}: solo el desierto queda sin ficha`);
    assert(b.hexes[b.robber].res === "desierto", `${label}: el ladrón arranca en el desierto`);
    assert(b.ports.length === def.ports.length, `${label}: puertos`);
    assert(b.ports.every(p => p.vertices.length === 2), `${label}: cada puerto ocupa dos vértices`);
  }
}

console.log("\nMISMA SEMILLA, MISMO MAPA:");
const a1 = generateBoard({ layout: "base", difficulty: "equilibrado", seed: "SEMILLA" });
const a2 = generateBoard({ layout: "base", difficulty: "equilibrado", seed: "SEMILLA" });
const a3 = generateBoard({ layout: "base", difficulty: "equilibrado", seed: "OTRA" });
assert(JSON.stringify(a1.hexes) === JSON.stringify(a2.hexes), "misma semilla ⇒ mismo tablero");
assert(JSON.stringify(a1.hexes) !== JSON.stringify(a3.hexes), "otra semilla ⇒ otro tablero");

console.log("\nDIFICULTAD:");
const official = generateBoard({ layout: "base", difficulty: "oficial", seed: "X" });
const os = boardBalance(official);
assert(os.reds === 0 && os.repeats === 0, "oficial: la espiral del reglamento no pega 6 con 8");

let equilibrados = 0, caos = 0, sumEq = 0, sumCaos = 0;
for (let i = 0; i < 25; i++) {
  const eq = boardBalance(generateBoard({ layout: "base", difficulty: "equilibrado" }));
  const ch = boardBalance(generateBoard({ layout: "base", difficulty: "caotico" }));
  if (eq.reds === 0 && eq.repeats === 0 && eq.hot === 0) equilibrados++;
  sumEq += eq.spread; sumCaos += ch.spread;
  caos += ch.reds + ch.hot;
}
assert(equilibrados === 25, `equilibrado: 25/25 sin 6-8 pegados ni números repetidos (dieron ${equilibrados})`);
assert(caos > 0, "caótico: busca activamente lo desparejo");
assert(sumCaos / 25 > sumEq / 25, `caótico desbalancea más los recursos (${(sumCaos/25).toFixed(1)} vs ${(sumEq/25).toFixed(1)})`);

let extOk = 0;
for (let i = 0; i < 60; i++) {
  const s = boardBalance(generateBoard({ layout: "ext", difficulty: "equilibrado" }));
  if (s.reds === 0 && s.hot === 0 && s.repeats === 0) extOk++;
}
assert(extOk === 60, `expansión equilibrada: 60/60 sin 6-8 pegados ni repetidos vecinos (dieron ${extOk})`);

console.log("\nESQUINAS (cargar poblados tocando el mapa):");
const mapa = generateBoard({ layout: "base", difficulty: "equilibrado", seed: "ESQ" });
const geoBase = geometry("base");
const interior = innerVertices(geoBase)[0];
const costa = geoBase.vertices.find(v => v.hexes.length === 1);
const hexInterior = hexesForVertex(mapa, interior.id);
assert(hexInterior.length <= 3 && hexInterior.length >= 2,
  `una esquina interior produce 2 o 3 hexágonos (dio ${hexInterior.length})`);
assert(hexInterior.every(h => h.res !== "desierto" && h.num),
  "el desierto no entra en lo que produce un poblado");
assert(hexesForVertex(mapa, costa.id).length <= 1, "una esquina de la costa toca un hexágono");
assert(hexesForVertex(mapa, "no-existe").length === 0, "un vértice inexistente no rompe");
const desierto = mapa.hexes.find(h => h.res === "desierto");
const vDesierto = geoBase.vertices.find(v => v.hexes.length === 1 && v.hexes[0] === desierto.id);
if (vDesierto) assert(hexesForVertex(mapa, vDesierto.id).length === 0,
  "una esquina que solo toca el desierto no produce nada");
const conPuerto = mapa.ports[0];
assert(portForVertex(mapa, conPuerto.vertices[0])?.type === conPuerto.type,
  "el puerto se reconoce desde su vértice");
assert(portForVertex(mapa, interior.id) === null, "una esquina interior no tiene puerto");

console.log("\nRECURSOS POR NÚMERO:");
const ocho = resourcesForNumber(mapa, 8);
assert(ocho.length > 0 && ocho.every(o => o.count > 0), "el 8 devuelve los recursos que tiene");
assert(ocho.reduce((a, o) => a + o.count, 0) === mapa.hexes.filter(h => h.num === 8).length,
  "los recursos del 8 suman todos los hexágonos con 8");
assert(resourcesForNumber(mapa, 7).length === 0, "el 7 no tiene hexágonos");
assert(resourcesForNumber(mapa, "").length === 0, "sin número no hay recursos que ofrecer");

console.log("\nPIPS:");
const pips = pipsByResource(official);
const totalPips = official.hexes.filter(h => h.num).reduce((a, h) => a + numberProb(h.num), 0);
assert(Object.values(pips).reduce((a, b) => a + b, 0) === totalPips, "los pips por recurso suman el total del tablero");
assert(official.hexes.filter(h => isRed(h.num)).length === 4, "clásico: cuatro fichas rojas (dos 6 y dos 8)");

console.log(failures === 0 ? "\n✅ Todo OK" : `\n❌ ${failures} fallas`);
process.exit(failures === 0 ? 0 : 1);
