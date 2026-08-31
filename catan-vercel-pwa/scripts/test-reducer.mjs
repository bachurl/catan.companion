// Smoke test del reducer: replaya una partida y verifica invariantes.
// Correr con: npm run test:reducer
import { gameReducer, initialGameState, replayActions, robberNum, robberRes } from "../src/game/reducer.js";
import { totalC } from "../src/game/constants.js";
import { mergeWithLocal } from "../src/online/mergeLog.js";
import { computeFinalScores, computeLongestRoad, computeLargestArmy } from "../src/game/selectors.js";
import { computeMatchStats } from "../src/game/stats.js";

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
assert(robberNum(s.robber) === 8 && robberRes(s.robber) === null, "ladrón en el 8 (sin recurso: bloquea todo el número)");

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

console.log("LADRÓN: bloquea un hexágono (num + res), no todo el número:");
{
  // Ana: 8-madera y 8-trigo. Beto: 8-oveja.
  const rob = [
    {
      type: "START_GAME", ts, mode: "full",
      players: [{ name: "Ana", ci: 0 }, { name: "Beto", ci: 1 }],
      settlements: {
        0: [{ hexes: [{ num: "8", res: "madera" }] }, { hexes: [{ num: "8", res: "trigo" }] }],
        1: [{ hexes: [{ num: "8", res: "oveja" }] }],
      },
      deck,
    },
    { type: "PLACE_ROBBER", ts, num: 8, res: "madera" },
    { type: "ROLL", ts, d1: 4, d2: 4, manual: true },
  ];
  let rs = replayActions(rob);
  assert(rs.players[0].hand.madera === 0, "el 8-madera queda bloqueado");
  assert(rs.players[0].hand.trigo === 1, "el 8-trigo de la misma jugadora SÍ produce");
  assert(rs.players[1].hand.oveja === 1, "el 8-oveja de Beto SÍ produce");
  assert(rs.lastDistribution.lines.length === 2, "la distribución lista a los dos jugadores");

  // Acción vieja (sin res): sigue bloqueando todo el número.
  const legacy = [rob[0], { type: "PLACE_ROBBER", ts, num: 8 }, rob[2]];
  const ls2 = replayActions(legacy);
  assert(totalC(ls2.players[0].hand) === 0 && totalC(ls2.players[1].hand) === 0, "acción vieja sin res bloquea todo el 8");

  // Contadores de tiradas
  assert(rs.rollCount === 1 && rs.diceTotals[8] === 1, "rollCount y diceTotals acumulan");
  rs = replayActions([...rob, { type: "ROLL", ts, d1: 4, d2: 4, manual: true }]);
  assert(rs.rollCount === 2 && rs.diceTotals[8] === 2, "segunda tirada acumula");
}

console.log("LADRÓN: dos hexágonos con el MISMO número y recurso (el 8 de 1-2 vs. el 8 de 2-3):");
{
  // Tres jugadores, todos con un 8-madera. Pero son DOS hexágonos distintos:
  // uno toca a Ana y Beto, el otro a Beto y Caro.
  const start = {
    type: "START_GAME", ts, mode: "full",
    players: [{ name: "Ana", ci: 0 }, { name: "Beto", ci: 1 }, { name: "Caro", ci: 2 }],
    settlements: {
      0: [{ hexes: [{ num: "8", res: "madera" }] }],
      1: [{ hexes: [{ num: "8", res: "madera" }] }],
      2: [{ hexes: [{ num: "8", res: "madera" }] }],
    },
    deck,
  };
  const roll8 = { type: "ROLL", ts, d1: 4, d2: 4, manual: true };

  // Ladrón en el 8-madera que toca a Ana y Beto
  let s2 = replayActions([start, { type: "PLACE_ROBBER", ts, num: 8, res: "madera", players: [0, 1] }, roll8]);
  assert(s2.players[0].hand.madera === 0, "Ana bloqueada");
  assert(s2.players[1].hand.madera === 0, "Beto bloqueado");
  assert(s2.players[2].hand.madera === 1, "Caro NO bloqueado: es el otro hexágono");

  // El otro 8-madera: toca a Beto y Caro
  s2 = replayActions([start, { type: "PLACE_ROBBER", ts, num: 8, res: "madera", players: [1, 2] }, roll8]);
  assert(s2.players[0].hand.madera === 1, "Ana produce con el otro hexágono bloqueado");
  assert(s2.players[1].hand.madera === 0, "Beto bloqueado (toca los dos hexágonos)");
  assert(s2.players[2].hand.madera === 0, "Caro bloqueado");

  // Mover el ladrón: la colocación nueva reemplaza a la anterior
  s2 = replayActions([start,
    { type: "PLACE_ROBBER", ts, num: 8, res: "madera", players: [0, 1] },
    { type: "PLACE_ROBBER", ts, num: 8, res: "madera", players: [1, 2] },
    roll8]);
  assert(s2.players[0].hand.madera === 1 && s2.players[2].hand.madera === 0, "mover el ladrón libera el hexágono anterior");

  // Sin `players` (o acción vieja): bloquea a todos los que tengan ese hexágono
  s2 = replayActions([start, { type: "PLACE_ROBBER", ts, num: 8, res: "madera" }, roll8]);
  assert(totalC(s2.players[0].hand) === 0 && totalC(s2.players[2].hand) === 0, "sin players bloquea a todos (compatibilidad)");

  // Reordenar jugadores mueve los índices del hexágono bloqueado
  const moved = replayActions([start,
    { type: "PLACE_ROBBER", ts, num: 8, res: "madera", players: [0, 1] },
    { type: "MOVE_PLAYER", ts, idx: 0, dir: 1 },
    roll8]);
  assert(moved.players[1].name === "Ana" && moved.players[1].hand.madera === 0, "Ana sigue bloqueada tras reordenar");
  assert(moved.players[2].name === "Caro" && moved.players[2].hand.madera === 1, "Caro sigue sin bloquear tras reordenar");
}

console.log("CORRECCIONES: cartas de desarrollo, stats, títulos y ciudades:");
{
  const fix = [
    {
      type: "START_GAME", ts, mode: "full",
      players: [{ name: "Ana", ci: 0 }, { name: "Beto", ci: 1 }],
      settlements: { 0: [{ hexes: [{ num: "6", res: "trigo" }] }], 1: [] },
      deck,
    },
  ];
  let fs = replayActions(fix);
  assert(computeFinalScores(fs.players, fs.titles)[0] === 1, "Ana arranca con 1 VP (un poblado)");

  // Cartas de desarrollo a mano (mazo físico)
  fix.push({ type: "ADJUST_DEV", ts, player: 0, card: "victoria", delta: 1 });
  fix.push({ type: "ADJUST_DEV", ts, player: 0, card: "victoria", delta: 1 });
  fs = replayActions(fix);
  assert(fs.players[0].devCards.filter(c => c === "victoria").length === 2, "2 cartas de victoria agregadas");
  assert(computeFinalScores(fs.players, fs.titles)[0] === 3, "las cartas de victoria suman al puntaje");
  fix.push({ type: "ADJUST_DEV", ts, player: 0, card: "victoria", delta: -1 });
  fs = replayActions(fix);
  assert(fs.players[0].devCards.filter(c => c === "victoria").length === 1, "sacar una carta funciona");
  assert(replayActions([...fix, { type: "ADJUST_DEV", ts, player: 1, card: "caballero", delta: -1 }]).players[1].devCards.length === 0,
    "sacar una carta que no tiene es no-op");

  // Título manual: Beto se queda el camino más largo sin tener 5 caminos
  fix.push({ type: "SET_TITLE", ts, title: "longestRoad", player: 1 });
  fs = replayActions(fix);
  assert(computeLongestRoad(fs.players, fs.titles) === 1, "camino más largo asignado a mano");
  assert(computeFinalScores(fs.players, fs.titles)[1] === 2, "el título da +2 VP aunque no tenga caminos cargados");
  fix.push({ type: "SET_TITLE", ts, title: "longestRoad", player: null });
  fs = replayActions(fix);
  assert(computeLongestRoad(fs.players, fs.titles) === null, "volver a null restaura el automático");

  // Stats manuales
  fix.push({ type: "ADJUST_STAT", ts, player: 1, stat: "knightsPlayed", delta: 3 });
  fs = replayActions(fix);
  assert(fs.players[1].knightsPlayed === 3 && computeLargestArmy(fs.players, fs.titles) === 1, "3 caballeros a mano dan el ejército");
  assert(replayActions([...fix, { type: "ADJUST_STAT", ts, player: 1, stat: "hack", delta: 9 }]).players[1].hack === undefined,
    "ADJUST_STAT ignora stats desconocidos");
  assert(replayActions([...fix, { type: "ADJUST_STAT", ts, player: 1, stat: "roadsBuilt", delta: -5 }]).players[1].roadsBuilt === 0,
    "los stats no bajan de 0");

  // Ciudades por corrección
  const gid = fs.players[0].productions[0].gid;
  fix.push({ type: "UPGRADE_CITY_FREE", ts, player: 0, gid });
  fs = replayActions(fix);
  assert(fs.players[0].productions[0].isCity === true, "poblado marcado como ciudad sin costo");
  assert(totalC(fs.players[0].hand) === 0, "no descuenta recursos");
  fix.push({ type: "ADD_FREE_SETTLEMENT", ts, player: 1, hexes: [{ num: "9", res: "mineral" }], isCity: true });
  fs = replayActions(fix);
  assert(fs.players[1].productions[0].isCity === true, "ciudad nueva cargada directa");
  fix.push({ type: "ROLL", ts, d1: 5, d2: 4, manual: true });
  fs = replayActions(fix);
  assert(fs.players[1].hand.mineral === 2, "la ciudad cargada produce doble");

  // MOVE_PLAYER reubica el título manual
  const moved = replayActions([
    ...fix.slice(0, 1),
    { type: "SET_TITLE", ts, title: "largestArmy", player: 0 },
    { type: "MOVE_PLAYER", ts, idx: 0, dir: 1 },
  ]);
  assert(moved.titles.largestArmy === 1 && moved.players[1].name === "Ana", "el título sigue al jugador al reordenar");
}

console.log("BUY_DEV con carta elegida (mazo físico):");
{
  const buy = [
    {
      type: "START_GAME", ts, mode: "simple",
      players: [{ name: "Ana", ci: 0 }], settlements: { 0: [] }, deck: ["caballero", "monopolio"],
    },
    { type: "BUY_DEV", ts, card: "monopolio" },
  ];
  let bs = replayActions(buy);
  assert(bs.players[0].devCards[0] === "monopolio", "se compra la carta elegida, no el tope del mazo");
  assert(bs.deck.length === 1 && bs.deck[0] === "caballero", "esa carta sale del mazo virtual");
  bs = replayActions([...buy, { type: "BUY_DEV", ts, card: "victoria" }]);
  assert(bs.players[0].devCards.length === 2, "se puede elegir una carta que el mazo virtual ya no tiene");
  assert(replayActions([...buy, { type: "BUY_DEV", ts }, { type: "BUY_DEV", ts }]).players[0].devCards.length === 2,
    "sin carta explícita usa el mazo virtual y se frena al vaciarse");
}

console.log("EXPANSIÓN 5-6: construir en turno ajeno:");
{
  const exp = [
    {
      type: "START_GAME", ts, mode: "full", expansion: true,
      players: [{ name: "Ana", ci: 0 }, { name: "Beto", ci: 1 }],
      settlements: { 0: [{ hexes: [{ num: "6", res: "trigo" }] }], 1: [{ hexes: [{ num: "6", res: "madera" }] }] },
      deck: ["monopolio", "caballero"],
    },
    // Beto junta recursos y construye un camino en el turno de Ana
    { type: "MANUAL_ADJUST", ts, player: 1, res: "madera", delta: 1 },
    { type: "MANUAL_ADJUST", ts, player: 1, res: "ladrillo", delta: 1 },
    { type: "BUILD_ROAD", ts, player: 1 },
  ];
  let es = replayActions(exp);
  assert(es.expansion === true, "la partida guarda el flag de expansión");
  assert(es.cp === 0, "sigue siendo el turno de Ana");
  assert(es.players[1].roadsBuilt === 1, "Beto construyó en el turno de Ana");
  assert(es.players[0].roadsBuilt === 0, "no se le cargó a la jugadora de turno");
  assert(totalC(es.players[1].hand) === 0, "el costo salió de la mano de Beto");

  // Sin `player` la construcción sigue siendo del jugador de turno (acciones viejas)
  assert(replayActions([...exp, { type: "MANUAL_ADJUST", ts, player: 0, res: "madera", delta: 1 },
    { type: "MANUAL_ADJUST", ts, player: 0, res: "ladrillo", delta: 1 },
    { type: "BUILD_ROAD", ts }]).players[0].roadsBuilt === 1, "sin player construye el de turno");

  // Carta comprada en turno ajeno: se puede jugar cuando llega su turno
  exp.push({ type: "MANUAL_ADJUST", ts, player: 1, res: "mineral", delta: 1 });
  exp.push({ type: "MANUAL_ADJUST", ts, player: 1, res: "trigo", delta: 1 });
  exp.push({ type: "MANUAL_ADJUST", ts, player: 1, res: "oveja", delta: 1 });
  exp.push({ type: "BUY_DEV", ts, player: 1, card: "caballero" });
  es = replayActions(exp);
  assert(es.players[1].devCards[0] === "caballero", "Beto compró en el turno de Ana");
  assert(es.players[1].devCardBought.includes("caballero"), "queda marcada como comprada");
  exp.push({ type: "END_TURN", ts }); // arranca el turno de Beto
  exp.push({ type: "ROLL", ts, d1: 1, d2: 1, manual: true });
  exp.push({ type: "PLAY_DEV", ts, card: "caballero", cardIdx: 0 });
  es = replayActions(exp);
  assert(es.cp === 1, "es el turno de Beto");
  assert(es.players[1].knightsPlayed === 1, "puede jugar en su turno la carta comprada en el ajeno");
}

console.log("mergeWithLocal (resync online):");
{
  const server = [{ uid: "a", type: "X" }, { uid: "b", type: "Y" }];
  const merged = mergeWithLocal(server, [{ uid: "b", type: "Y" }, { uid: "c", type: "Z" }, { uid: "c", type: "Z" }]);
  assert(merged.length === 3 && merged[2].uid === "c", "canónico primero, extra local al final, sin duplicados");
  assert(mergeWithLocal(server, []).length === 2, "sin extras devuelve el canónico");
  assert(mergeWithLocal([], [{ uid: "c", type: "Z" }]).length === 1, "server vacío conserva lo local");
  assert(mergeWithLocal(server, [{ type: "SIN_UID" }]).length === 2, "extra sin uid se descarta");
}

console.log("computeMatchStats (estadísticas en vivo):");
{
  const base = [{
    type: "START_GAME", ts, mode: "full",
    players: [{ name: "Ana", ci: 0 }, { name: "Beto", ci: 1 }],
    settlements: {
      0: [{ hexes: [{ num: "8", res: "madera" }] }, { hexes: [{ num: "6", res: "ladrillo" }] }],
      1: [{ hexes: [{ num: "8", res: "oveja" }] }, { hexes: [{ num: "10", res: "mineral" }] }],
    },
    deck: ["caballero", "victoria"],
  }];

  // Estado inicial: nada acumulado todavía, pero las estadísticas ya existen.
  let st = computeMatchStats(base);
  assert(st.players.length === 2, "una fila de estadísticas por jugador");
  assert(st.players[0].producedTotal === 0, "sin producción al arrancar");
  assert(st.players[0].settlementsNow === 2, "Ana arranca con 2 poblados");
  assert(st.players[0].pips === 5 + 5, "los puntos de dados salen del 8 y el 6");
  assert(st.rollCount === 0, "sin tiradas");

  // Una tirada de 8: cobran los dos, cada uno lo suyo.
  const rolled = [...base, { type: "ROLL", ts, d1: 4, d2: 4, manual: false }];
  st = computeMatchStats(rolled);
  assert(st.players[0].produced.madera === 1, "Ana cobró 1 madera con el 8");
  assert(st.players[1].produced.oveja === 1, "Beto cobró 1 oveja con el 8");
  assert(st.players[0].producedTotal === 1 && st.players[1].producedTotal === 1, "1 carta cada uno");
  assert(st.players[0].rolls === 1 && st.players[1].rolls === 0, "la tirada es de quien tenía el turno");
  assert(st.rollCount === 1 && st.dice.rows.find(r => r.n === 8).count === 1, "el 8 figura en la distribución");

  // El ladrón en el 8 de madera: lo que Ana no cobra queda contado como bloqueado.
  const blocked = [...base,
    { type: "PLACE_ROBBER", ts, num: 8, res: "madera", players: [0] },
    { type: "ROLL", ts, d1: 4, d2: 4, manual: false },
  ];
  st = computeMatchStats(blocked);
  assert(st.players[0].produced.madera === 0, "Ana no cobra el hexágono bloqueado");
  assert(st.players[0].blocked === 1, "el bloqueo se cuenta como recurso perdido");
  assert(st.players[1].produced.oveja === 1 && st.players[1].blocked === 0, "el ladrón no toca a Beto");

  // Construcciones, compras, comercio y robos.
  const rich = [...base];
  for (let i = 0; i < 6; i++) rich.push({ type: "ROLL", ts, d1: 4, d2: 4, manual: false });
  rich.push({ type: "MANUAL_ADJUST", ts, player: 0, res: "ladrillo", delta: 6 });
  rich.push({ type: "BUILD_ROAD", ts });
  rich.push({ type: "TRADE_BANK", ts, give: "madera", receive: "trigo", ratio: 4 });
  rich.push({ type: "STEAL", ts, victim: 1, res: "oveja" });
  rich.push({ type: "END_TURN", ts });
  st = computeMatchStats(rich);
  assert(st.players[0].roads === 1, "un camino construido");
  assert(st.players[0].spent === 2, "el camino costó 2 recursos");
  assert(st.players[0].tradesBank === 1, "un cambio con el banco");
  assert(st.players[0].stolenFromOthers === 1, "Ana robó una vez");
  assert(st.players[1].robbedByOthers === 1 && st.players[1].lost === 1, "a Beto le robaron una");
  assert(st.players[0].turns === 1, "Ana terminó un turno");

  // Una acción rechazada por el reducer (no alcanza para pagar) no cuenta.
  const broke = [...base, { type: "BUILD_ROAD", ts }];
  st = computeMatchStats(broke);
  assert(st.players[0].roads === 0, "una construcción rechazada no se cuenta");

  // Deshacer: las estadísticas vuelven atrás porque salen del log.
  const undone = [...rolled, { type: "UNDO", ts }];
  st = computeMatchStats(undone);
  assert(st.players[0].producedTotal === 0 && st.rollCount === 0, "el undo revierte las estadísticas");

  // La carrera de puntos avanza con las rondas.
  const rounds = [...base];
  for (let r = 0; r < 3; r++) { rounds.push({ type: "END_TURN", ts }); rounds.push({ type: "END_TURN", ts }); }
  st = computeMatchStats(rounds);
  assert(st.timeline.length >= 3, "la carrera de puntos tiene un punto por ronda");
  assert(st.timeline.every(t => t.scores.length === 2), "cada punto trae el puntaje de todos");
  assert(st.timeline[0].scores[0] === 2, "Ana arranca en 2 puntos (2 poblados)");
  assert(st.timeline[st.timeline.length - 1].round === st.round, "el último punto es la ronda actual");

  // Reordenar asientos mueve las estadísticas con el jugador.
  const moved = [...rolled,
    { type: "MANUAL_ADJUST", ts, player: 0, res: "ladrillo", delta: 6 },
    { type: "BUILD_ROAD", ts },
    { type: "MOVE_PLAYER", ts, idx: 0, dir: 1 },
  ];
  st = computeMatchStats(moved);
  assert(st.players[1].roads === 1 && st.players[0].roads === 0, "el camino sigue a Ana al asiento 1");
  assert(st.players[1].produced.madera === 1, "la producción también acompaña el reordenamiento");

  // Correcciones de la mesa: cuentan como construcciones reales.
  const fixed = [...base,
    { type: "ADD_FREE_SETTLEMENT", ts, player: 1, hexes: [{ num: "5", res: "trigo" }], isCity: true },
  ];
  st = computeMatchStats(fixed);
  assert(st.players[1].cities === 1 && st.players[1].citiesNow === 1, "una ciudad cargada a mano se cuenta");

  // El 7 no compite como número más/menos salido: no produce recursos.
  const sevens = [...base,
    { type: "ROLL", ts, d1: 3, d2: 4, manual: false },
    { type: "ROLL", ts, d1: 3, d2: 4, manual: false },
    { type: "ROLL", ts, d1: 3, d2: 4, manual: false },
  ];
  st = computeMatchStats(sevens);
  assert(st.dice.sevens === 3, "los sietes se cuentan aparte");
  assert(st.dice.hot.n !== 7 && st.dice.cold.n !== 7, "el 7 queda afuera de más/menos salió");
  assert(st.dice.since7 === 0, "el último 7 fue la tirada más reciente");
  st = computeMatchStats([...sevens, { type: "ROLL", ts, d1: 3, d2: 3, manual: false }]);
  assert(st.dice.since7 === 1, "una tirada después del 7");
  assert(computeMatchStats(rolled).dice.since7 === null, "sin sietes todavía no hay cuenta");

  // Determinismo.
  assert(JSON.stringify(computeMatchStats(rich)) === JSON.stringify(computeMatchStats(rich)),
    "las estadísticas son determinísticas");
}

console.log("Determinismo (replay dos veces = mismo estado):");
const s1 = JSON.stringify(replayActions(actions));
const s2 = JSON.stringify(replayActions(actions));
assert(s1 === s2, "replay determinístico");

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}
console.log("\nTodos los tests OK");
