// Tests del reconocimiento por foto: cómo se convierte lo que devuelve el
// endpoint en un tablero, y qué se avisa cuando no cierra.
// Correr con: npm run test:photo
import { boardFromRecognition, boardIssues, patchHex } from "../src/board/photo.js";
import { LAYOUTS, geometry } from "../src/board/geometry.js";

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

// Una lectura "perfecta" de un tablero: las piezas exactas de la caja.
const lecturaCompleta = (layout, conf = 0.95) => {
  const def = LAYOUTS[layout];
  const terrenos = Object.entries(def.terrains).flatMap(([res, n]) => Array(n).fill(res));
  const numeros = [...def.numbers];
  const out = [];
  let t = 0, ni = 0;
  def.rows.forEach((len, row) => {
    for (let col = 0; col < len; col++) {
      const res = terrenos[t++];
      out.push({ row, col, res, num: res === "desierto" ? null : numeros[ni++], confidence: conf });
    }
  });
  return out;
};

console.log("LECTURA COMPLETA:");
for (const layout of ["base", "ext"]) {
  const leido = lecturaCompleta(layout);
  const { board, confidence, issues } = boardFromRecognition(layout, leido);
  const total = LAYOUTS[layout].rows.reduce((a, b) => a + b, 0);
  assert(board.hexes.length === total, `${layout}: ${total} hexágonos`);
  assert(issues.length === 0, `${layout}: un tablero bien leído no tiene avisos`);
  assert(board.hexes.every(h => (h.res === "desierto") === (h.num === null)), `${layout}: solo el desierto queda sin ficha`);
  assert(board.hexes[board.robber].res === "desierto", `${layout}: el ladrón arranca en el desierto`);
  assert(board.ports.length === LAYOUTS[layout].ports.length, `${layout}: puertos en las posiciones de siempre`);
  assert(Object.keys(confidence).length === total, `${layout}: hay confianza por hexágono`);
  assert(board.source === "foto", `${layout}: queda marcado que salió de una foto`);
}

console.log("\nLECTURA INCOMPLETA O CON ERRORES:");
const leido = lecturaCompleta("base");
const parcial = boardFromRecognition("base", leido.slice(0, 12));
assert(parcial.board.hexes.length === 19, "los hexágonos que faltan quedan vacíos, no se descartan");
assert(parcial.board.hexes.filter(h => !h.res).length === 7, "7 hexágonos quedan sin reconocer");
assert(parcial.issues.some(t => t.includes("sin reconocer")), "avisa cuántos quedaron sin reconocer");

const duplicado = leido.map((h, i) => (i === 0 ? { ...h, res: "oveja" } : h));
const conDup = boardFromRecognition("base", duplicado);
assert(conDup.issues.length === 1 && conDup.issues[0].includes("sobra 1 Oveja") && conDup.issues[0].includes("falta 1 Madera"),
  `avisa qué terreno sobra y cuál falta (dijo: ${conDup.issues[0]})`);

const numeroMal = leido.map(h => (h.num === 8 ? { ...h, num: 9 } : h));
const conNumMal = boardFromRecognition("base", numeroMal);
assert(conNumMal.issues.some(t => t.startsWith("Fichas:")), "avisa cuando las fichas no cierran");

console.log("\nBASURA EN LA RESPUESTA:");
const sucio = [
  ...leido.slice(0, 3),
  { row: 99, col: 0, res: "madera", num: 5, confidence: 1 },   // fuera del tablero
  { row: 1, col: 0, res: "chocolate", num: 5, confidence: 1 }, // recurso inventado
  { row: 1, col: 1, res: "madera", num: 7, confidence: 1 },    // el 7 no existe
  { row: 1, col: 2, res: "desierto", num: 6, confidence: 1 },  // desierto con ficha
];
const limpio = boardFromRecognition("base", sucio);
assert(limpio.board.hexes.length === 19, "un hexágono fuera del tablero no agrega nada");
assert(limpio.board.hexes.find(h => h.row === 1 && h.col === 0).res === null, "un recurso inventado se descarta");
assert(limpio.board.hexes.find(h => h.row === 1 && h.col === 1).num === null, "la ficha del 7 se descarta");
assert(limpio.board.hexes.find(h => h.row === 1 && h.col === 2).num === null, "el desierto nunca lleva ficha");
assert(boardFromRecognition("base", []).board.hexes.every(h => !h.res), "una respuesta vacía no rompe");
assert(boardFromRecognition("base", [null, undefined, {}]).board.hexes.every(h => !h.res), "entradas rotas no rompen");

console.log("\nCORRECCIÓN A MANO:");
const { board } = boardFromRecognition("base", leido);
const geo = geometry("base");
const otro = board.hexes.find(h => h.res !== "desierto");
const movido = patchHex(board, otro.id, { res: "desierto" });
assert(movido.robber === otro.id, "al mover el desierto, el ladrón se muda con él");
assert(movido.hexes[otro.id].num === null, "el hexágono que pasa a desierto pierde la ficha");
assert(movido.hexes.length === board.hexes.length && movido.layout === board.layout, "corregir no rompe el resto del tablero");
const corregido = patchHex(board, otro.id, { num: 11 });
assert(corregido.hexes[otro.id].num === 11 && board.hexes[otro.id].num === otro.num, "corregir no muta el tablero anterior");
assert(geo.hexes.length === 19, "la geometría sigue siendo la misma de siempre");

console.log(failures === 0 ? "\n✅ Todo OK" : `\n❌ ${failures} fallas`);
process.exit(failures === 0 ? 0 : 1);
