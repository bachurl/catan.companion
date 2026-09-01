// ═══════════════════════════════════════════════
//  HISTORIAL DE PARTIDAS TERMINADAS
//
//  Se guarda el log de acciones completo de cada partida, no un resumen: con
//  el log, `computeMatchStats` reconstruye las mismas estadísticas que se
//  vieron durante el juego, así que el historial muestra la partida entera y
//  no una foto recortada. Es la misma decisión que la persistencia de la
//  partida en curso (guardar el log, derivar el resto).
//
//  Antes de esto una partida terminada se perdía en silencio: `loadSavedGame`
//  la descartaba al recargar porque ya estaba ganada.
// ═══════════════════════════════════════════════
import { replayActions } from "./reducer.js";
import { computeTrueScores, WINNING_SCORE } from "./selectors.js";

const HISTORY_KEY = "catan.historial.v1";
// Tope de partidas guardadas. Cada log ronda las 30 KB, así que 20 partidas
// entran de sobra en localStorage y dejan lugar para la partida en curso.
const MAX_GAMES = 20;

// Id estable de la partida: el uid de su primera acción. Sirve para que
// archivar sea idempotente — una partida que se corrige después de ganada
// (o que se sigue jugando) actualiza su entrada en vez de duplicarse.
export const gameId = (actions) => actions?.[0]?.uid || null;

const read = () => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data?.games) ? data.games : [];
  } catch {
    return [];
  }
};

// Escribe recortando de a una partida vieja si el storage está lleno: es mejor
// perder la más antigua que perder la que se acaba de jugar.
const write = (games) => {
  let list = games.slice(0, MAX_GAMES);
  while (list.length > 0) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify({ v: 1, games: list }));
      return list;
    } catch {
      list = list.slice(0, -1);
    }
  }
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* sin storage */ }
  return [];
};

// Resumen para el listado. Se calcula al archivar y se guarda, así la pantalla
// de historial no tiene que replayar 20 logs para dibujar una lista.
export const summarize = (actions) => {
  const state = replayActions(actions);
  // Puntaje real: la partida ya terminó, así que las cartas de punto que
  // nunca se revelaron también cuentan (son las que la definieron).
  const scores = computeTrueScores(state.players, state.titles);
  let winner = null, best = -1;
  scores.forEach((s, i) => { if (s > best) { best = s; winner = i; } });
  return {
    players: state.players.map(p => ({ name: p.name, ci: p.ci })),
    scores,
    winner,
    winnerScore: best,
    round: state.turn,
    rollCount: state.rollCount || 0,
    gameMode: state.gameMode,
    expansion: !!state.expansion,
    // Una partida puede archivarse sin que nadie llegue a 10 (se abandonó).
    finished: best >= WINNING_SCORE,
  };
};

export const loadHistory = () => read();

// Archiva (o actualiza) una partida. Devuelve el historial resultante.
export const archiveGame = (actions, finishedAt = Date.now()) => {
  const id = gameId(actions);
  if (!id || !Array.isArray(actions) || actions.length === 0) return read();
  const state = replayActions(actions);
  if (!state.started) return read(); // un lobby sin partida no es historial

  const entry = { id, finishedAt, actions, summary: summarize(actions) };
  const rest = read().filter(g => g.id !== id);
  return write([entry, ...rest]);
};

export const deleteGame = (id) => write(read().filter(g => g.id !== id));

export const clearHistory = () => write([]);

// ¿Esta partida ya está archivada con este mismo log? Evita reescribir el
// storage en cada render mientras el cartel de victoria está abierto.
export const isArchived = (actions) => {
  const id = gameId(actions);
  if (!id) return false;
  const g = read().find(x => x.id === id);
  return Boolean(g) && g.actions.length === actions.length;
};
