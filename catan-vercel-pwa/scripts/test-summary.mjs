// Smoke test del resumen de partida (historial).
// Correr con: npm run test:summary
import { summarizeGame, gameIdOf } from "../src/game/summary.js";

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

const t0 = 1700000000000;
const actions = [
  {
    type: "START_GAME", ts: t0, uid: "u-start", mode: "full",
    players: [{ name: "Ana", ci: 0 }, { name: "Beto", ci: 1 }],
    settlements: {
      0: [{ hexes: [{ num: "8", res: "madera" }, { num: "5", res: "trigo" }] }, { hexes: [{ num: "6", res: "ladrillo" }] }],
      1: [{ hexes: [{ num: "8", res: "oveja" }] }, { hexes: [{ num: "10", res: "mineral" }] }],
    },
    deck: ["caballero", "victoria"],
  },
  { type: "ROLL", ts: t0 + 1000, uid: "u1", d1: 4, d2: 4 },
  { type: "END_TURN", ts: t0 + 2000, uid: "u2" },
  { type: "ROLL", ts: t0 + 3000, uid: "u3", d1: 3, d2: 5 },
  { type: "END_TURN", ts: t0 + 4000, uid: "u4" },
  { type: "ROLL", ts: t0 + 600000, uid: "u5", d1: 1, d2: 1, manual: true },
];

console.log("Resumen de una partida en curso:");
const s = summarizeGame(actions);
assert(gameIdOf(actions) === "u-start", "el id de la partida es el uid de START_GAME");
assert(s.id === "u-start", "el resumen lleva ese id");
assert(s.status === "playing", "estado: en curso");
assert(s.playerCount === 2 && s.players[0].name === "Ana", "jugadores del resumen");
assert(s.rollCount === 3 && s.rolls.length === 3, "cuenta las tiradas");
assert(s.diceTotals[8] === 2 && s.diceTotals[2] === 1, "acumula los números que salieron");
assert(s.rolls[1].playerIndex === 1 && s.rolls[1].playerName === "Beto", "cada tirada guarda de quién fue");
assert(s.rolls[2].manual === true, "distingue las tiradas manuales");
assert(s.durationSeconds === 600, "duración = del inicio a la última acción");
assert(s.players[0].settlements === 2 && s.players[0].cities === 0, "poblados por jugador");
assert(s.winnerIndex === null, "sin ganador todavía");

console.log("Partida terminada:");
// 10 PV a mano: poblados libres hasta ganar.
const finish = [...actions];
for (let i = 0; i < 4; i++) {
  finish.push({
    type: "ADD_FREE_SETTLEMENT", ts: t0 + 700000 + i, uid: `f${i}`, player: 0,
    hexes: [{ num: "9", res: "trigo" }], isCity: true,
  });
}
const f = summarizeGame(finish);
assert(f.status === "finished", "estado: terminada");
assert(f.winnerIndex === 0 && f.winnerName === "Ana", "identifica al ganador");
assert(f.id === s.id, "mismo id: guardar de nuevo pisa la misma partida");

console.log(failures === 0 ? "\nTodos los tests OK" : `\n${failures} test(s) fallaron`);
process.exit(failures === 0 ? 0 : 1);
