// ═══════════════════════════════════════════════
//  RESUMEN DE PARTIDA
//
//  Deriva, del log de acciones, todo lo que se guarda en el historial:
//  identificador estable, jugadores, puntajes, duración y tiradas.
//  Es una función pura sobre el log (misma fuente de verdad que el juego),
//  así el resumen de una partida vieja se puede recalcular sin migraciones.
// ═══════════════════════════════════════════════
import { initialGameState, gameReducer, effectiveActions } from "./reducer.js";
import { computeScores, computeTrueScores, computeLargestArmy, computeLongestRoad, WINNING_SCORE } from "./selectors.js";

const START_TYPES = new Set(["START_GAME", "CREATE_LOBBY"]);

// Poblados/ciudades de un jugador (las producciones se agrupan por `gid`).
const countBuildings = (p) => {
  const isCity = {};
  p.productions.forEach(pr => { isCity[pr.gid] = isCity[pr.gid] || pr.isCity; });
  const vals = Object.values(isCity);
  return { settlements: vals.filter(c => !c).length, cities: vals.filter(c => c).length };
};

// id estable de la partida: el uid de su primera acción. Es el mismo criterio
// que usa el archivo local (`game/history.js`), así una partida tiene un solo
// id en el dispositivo y en la base. Sobrevive a recargas y resyncs.
export const gameIdOf = (actions) =>
  actions?.[0]?.uid || actions?.find(a => START_TYPES.has(a.type))?.uid || null;

// Recorre el log una sola vez: estado final + tiradas con su jugador y momento.
export function summarizeGame(rawActions) {
  const id = gameIdOf(rawActions);
  if (!id || rawActions.length === 0) return null;
  // Lo deshecho no cuenta: se resume el log efectivo, igual que replayActions.
  const actions = effectiveActions(rawActions);
  if (actions.length === 0) return null;

  let state = initialGameState;
  const rolls = [];
  let startedAt = null;
  let lastTs = null;

  actions.forEach((a) => {
    if (a.type === "ROLL") {
      rolls.push({
        seq: rolls.length + 1,
        d1: a.d1, d2: a.d2, total: a.d1 + a.d2,
        playerIndex: state.cp,
        playerName: state.players[state.cp]?.name || null,
        manual: !!a.manual,
        ts: a.ts || null,
      });
    }
    if (a.type === "START_GAME" || a.type === "BEGIN_GAME") startedAt = a.ts || startedAt;
    if (a.ts) lastTs = a.ts;
    state = gameReducer(state, a);
  });

  // El lobby existe antes de empezar: si nunca hubo START_GAME/BEGIN_GAME
  // se usa el ts de la creación como inicio.
  if (startedAt === null) startedAt = actions[0].ts || null;

  // El historial guarda el puntaje real (incluye las cartas de punto que
  // nunca se revelaron): es el que decidió la partida.
  const finalScores = computeTrueScores(state.players, state.titles);
  const baseScores = computeScores(state.players);
  const army = computeLargestArmy(state.players, state.titles);
  const road = computeLongestRoad(state.players, state.titles);
  const winnerIndex = finalScores.findIndex(s => s >= WINNING_SCORE);
  const finished = winnerIndex >= 0;

  return {
    id,
    mode: state.gameMode,
    expansion: !!state.expansion,
    playerCount: state.players.length,
    status: finished ? "finished" : (state.started ? "playing" : "lobby"),
    startedAt,
    // Una partida sin terminar dura, por ahora, hasta su última acción.
    endedAt: lastTs,
    durationSeconds: startedAt && lastTs ? Math.max(0, Math.round((lastTs - startedAt) / 1000)) : null,
    turns: state.turn,
    rollCount: state.rollCount,
    diceTotals: state.diceTotals,
    winnerIndex: finished ? winnerIndex : null,
    winnerName: finished ? (state.players[winnerIndex]?.name || null) : null,
    players: state.players.map((p, i) => {
      const { settlements, cities } = countBuildings(p);
      return {
        playerIndex: i,
        name: p.name,
        colorIndex: p.ci,
        vp: finalScores[i],
        vpBase: baseScores[i],
        settlements, cities,
        roadsBuilt: p.roadsBuilt,
        knights: p.knightsPlayed,
        devCards: p.devCardBought.length,
        longestRoad: road === i,
        largestArmy: army === i,
      };
    }),
    rolls,
  };
}
