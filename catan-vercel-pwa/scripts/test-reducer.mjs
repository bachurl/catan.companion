// Smoke test del reducer: replaya una partida y verifica invariantes.
// Correr con: npm run test:reducer
import { gameReducer, initialGameState, replayActions } from "../src/game/reducer.js";
import { totalC } from "../src/game/constants.js";

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

const ts = 1700000000000;
const deck = ["caballero", "victoria", "monopolio", "abundancia", "caminos", "caballero"];

const actions = [
  {
    type: "START_GAME", ts, mode: "full",
    players: [{ name: "Ana", ci: 0 }, { name: "Beto", ci: 1 }],
    settlements: {
      0: [{ hexes: [{ num: "8", res: "madera" }, { num: "5", res: "trigo" }] }, { hexes: [{ num: "6", res: "ladrillo" }] }],
      1: [{ hexes: [{ num: "8", res: "oveja" }] }, { hexes: [{ num: "10", res: "mineral" }] }],
    },
    deck,
  },
];

console.log("START_GAME:");
let s = replayActions(actions);
assert(s.started === true, "started");
assert(s.players.length === 2, "2 jugadores");
assert(s.players[0].productions.length === 3, "Ana tiene 3 producciones");
assert(s.players[1].productions.length === 2, "Beto tiene 2 producciones");
assert(new Set(s.players.flatMap(p => p.productions.map(pr => pr.gid))).size === 4, "4 poblados distintos");
assert(s.cp === 0, "empieza el jugador 0");

console.log("ROLL 8 (distribuye):");
actions.push({ type: "ROLL", ts, d1: 4, d2: 4, manual: false });
s = replayActions(actions);
assert(s.players[0].hand.madera === 1, "Ana +1 madera");
assert(s.players[1].hand.oveja === 1, "Beto +1 oveja");
assert(s.turnPhase === "rolled", "turnPhase rolled");
assert(s.diceHistory[0] === 8, "historial registra 8");
assert(s.lastDistribution.lines.length === 2, "2 líneas de distribución");

console.log("MANUAL_ADJUST + BUILD_ROAD (modo full descuenta):");
actions.push({ type: "MANUAL_ADJUST", ts, player: 0, res: "ladrillo", delta: 1 });
actions.push({ type: "BUILD_ROAD", ts });
s = replayActions(actions);
assert(s.players[0].roadsBuilt === 1, "camino construido");
assert(s.players[0].hand.madera === 0 && s.players[0].hand.ladrillo === 0, "costo descontado");

console.log("BUILD_ROAD sin recursos (modo full rechaza):");
actions.push({ type: "BUILD_ROAD", ts });
s = replayActions(actions);
assert(s.players[0].roadsBuilt === 1, "no construye sin recursos");

console.log("END_TURN:");
actions.push({ type: "END_TURN", ts });
s = replayActions(actions);
assert(s.cp === 1, "turno pasa a Beto");
assert(s.turnPhase === "preroll", "vuelve a preroll");
assert(s.dice[0] === 0, "dados reseteados");

console.log("ROLL 7 + DISCARD + PLACE_ROBBER + STEAL:");
for (let i = 0; i < 8; i++) actions.push({ type: "MANUAL_ADJUST", ts, player: 0, res: "trigo", delta: 1 });
actions.push({ type: "ROLL", ts, d1: 3, d2: 4, manual: true });
s = replayActions(actions);
assert(totalC(s.players[0].hand) === 8, "Ana tiene 8 cartas (debe descartar)");
actions.push({ type: "DISCARD", ts, player: 0, discards: { madera: 0, ladrillo: 0, trigo: 4, oveja: 0, mineral: 0 } });
actions.push({ type: "PLACE_ROBBER", ts, num: 8 });
actions.push({ type: "STEAL", ts, victim: 0, res: "trigo" });
s = replayActions(actions);
assert(totalC(s.players[0].hand) === 3, "Ana descartó 4 y le robaron 1");
assert(s.players[1].hand.trigo === 1, "Beto robó 1 trigo");
assert(s.robber === 8, "ladrón en el 8");

console.log("ROLL bloqueado por ladrón:");
actions.push({ type: "END_TURN", ts });
actions.push({ type: "ROLL", ts, d1: 4, d2: 4, manual: false });
s = replayActions(actions);
assert(s.players[0].hand.madera === 0, "el 8 no produce (bloqueado)");
assert(s.lastDistribution.lines.length === 0, "distribución vacía");

console.log("BUY_DEV + PLAY_DEV (regla: no jugar carta comprada este turno):");
for (const r of ["mineral", "trigo", "oveja"]) actions.push({ type: "MANUAL_ADJUST", ts, player: 0, res: r, delta: 1 });
actions.push({ type: "BUY_DEV", ts });
s = replayActions(actions);
assert(s.players[0].devCards.length === 1 && s.players[0].devCards[0] === "caballero", "compró el caballero (tope del mazo)");
assert(s.deck.length === deck.length - 1, "mazo decrementado");
const before = replayActions(actions);
actions.push({ type: "PLAY_DEV", ts, card: "caballero", cardIdx: 0 });
s = replayActions(actions);
assert(s.players[0].knightsPlayed === before.players[0].knightsPlayed, "PLAY_DEV rechazado (comprada este turno)");
actions.push({ type: "END_TURN", ts });
actions.push({ type: "ROLL", ts, d1: 2, d2: 3, manual: false });
actions.push({ type: "END_TURN", ts });
actions.push({ type: "ROLL", ts, d1: 2, d2: 3, manual: false });
actions.push({ type: "PLAY_DEV", ts, card: "caballero", cardIdx: 0 });
s = replayActions(actions);
assert(s.players[0].knightsPlayed === 1, "caballero jugado al turno siguiente");

console.log("UPGRADE_CITY (modo simple no descuenta):");
const simpleActions = [
  {
    type: "START_GAME", ts, mode: "simple",
    players: [{ name: "A", ci: 0 }, { name: "B", ci: 1 }],
    settlements: { 0: [{ hexes: [{ num: "6", res: "trigo" }] }], 1: [] },
    deck,
  },
];
let ss = replayActions(simpleActions);
const g = ss.players[0].productions[0].gid;
simpleActions.push({ type: "UPGRADE_CITY", ts, gid: g });
ss = replayActions(simpleActions);
assert(ss.players[0].productions[0].isCity === true, "ciudad sin recursos en modo simple");
assert(totalC(ss.players[0].hand) === 0, "mano intacta");
simpleActions.push({ type: "ROLL", ts, d1: 3, d2: 3, manual: true });
ss = replayActions(simpleActions);
assert(ss.players[0].hand.trigo === 2, "ciudad produce doble");

console.log("MOVE_PLAYER:");
actions.push({ type: "MOVE_PLAYER", ts, idx: 0, dir: 1 });
const prevCp = s.cp;
s = replayActions(actions);
assert(s.players[0].name === "Beto" && s.players[1].name === "Ana", "orden intercambiado");
assert(s.cp !== prevCp || prevCp > 1, "cp sigue al jugador físico");

console.log("UNDO como marcador del log:");
actions.push({ type: "UNDO", ts });
s = replayActions(actions);
assert(s.players[0].name === "Ana", "UNDO revierte el cambio de orden");
actions.push({ type: "UNDO", ts });
s = replayActions(actions);
assert(s.players[0].knightsPlayed === 0, "segundo UNDO revierte el caballero jugado");

console.log("LOBBY: CREATE_LOBBY → SET_PLAYER_NAME → SET_INITIAL_SETTLEMENTS → BEGIN_GAME:");
const lobbyActions = [
  { type: "CREATE_LOBBY", ts, mode: "full", playerCount: 3, deck },
];
let ls = replayActions(lobbyActions);
assert(ls.inLobby === true && ls.started === false, "lobby creado, partida sin empezar");
assert(ls.players.length === 3, "3 asientos con placeholders");
lobbyActions.push({ type: "SET_PLAYER_NAME", ts, player: 1, name: "Caro", ci: 3 });
lobbyActions.push({ type: "SET_INITIAL_SETTLEMENTS", ts, player: 1, settlements: [{ hexes: [{ num: "6", res: "trigo" }] }, { hexes: [{ num: "9", res: "madera" }] }] });
ls = replayActions(lobbyActions);
assert(ls.players[1].name === "Caro" && ls.players[1].ci === 3, "nombre y color seteados");
assert(ls.players[1].productions.length === 2, "2 poblados cargados");
lobbyActions.push({ type: "SET_INITIAL_SETTLEMENTS", ts, player: 1, settlements: [{ hexes: [{ num: "6", res: "trigo" }, { num: "10", res: "oveja" }] }] });
ls = replayActions(lobbyActions);
assert(ls.players[1].productions.length === 2 && new Set(ls.players[1].productions.map(p => p.gid)).size === 1, "re-guardar reemplaza (1 poblado con 2 hexes)");
lobbyActions.push({ type: "BEGIN_GAME", ts });
ls = replayActions(lobbyActions);
assert(ls.started === true && ls.inLobby === false, "BEGIN_GAME arranca la partida");
lobbyActions.push({ type: "ROLL", ts, d1: 3, d2: 3, manual: true });
ls = replayActions(lobbyActions);
assert(ls.players[1].hand.trigo === 1, "el 6 produce para Caro tras empezar");
assert(replayActions([...lobbyActions, { type: "BEGIN_GAME", ts }]).started === true, "BEGIN_GAME repetido es inofensivo");
assert(replayActions([...lobbyActions, { type: "SET_INITIAL_SETTLEMENTS", ts, player: 1, settlements: [] }]).players[1].productions.length === 2, "SET_INITIAL_SETTLEMENTS ignorado con partida empezada");

console.log("Determinismo (replay dos veces = mismo estado):");
const s1 = JSON.stringify(replayActions(actions));
const s2 = JSON.stringify(replayActions(actions));
assert(s1 === s2, "replay determinístico");

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}
console.log("\nTodos los tests OK");
