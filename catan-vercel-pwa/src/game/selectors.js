// Valores derivados del estado del juego (funciones puras).

// ── PUNTOS VISIBLES vs. PUNTOS REALES ──
// Una carta de punto de victoria en la mano es secreta: nadie la ve hasta que
// su dueño la revela. Por eso hay dos cuentas:
//   · la pública (computeScores/computeFinalScores), que es la que muestra la
//     app a la mesa, y solo cuenta las cartas ya reveladas;
//   · la real (computeTrueScores), que suma además las cartas sin revelar y es
//     la que decide si alguien ganó.
// El jugador con 8 puntos a la vista y una carta guardada gana al llegar a 9
// visibles, sin haber tenido que mostrarla antes.

// Cartas de punto que el jugador tiene guardadas, sin revelar.
export const hiddenVP = (p) => p.devCards.filter(c => c === "victoria").length;

export const computeScores = (players) => players.map(p => {
  const grp = {};
  p.productions.forEach(pr => {
    if (!grp[pr.gid]) grp[pr.gid] = false;
    if (pr.isCity) grp[pr.gid] = true;
  });
  const sett = Object.values(grp).filter(c => !c).length;
  const cit = Object.values(grp).filter(c => c).length;
  return sett + cit * 2 + (p.vpRevealed || 0);
});

// Los títulos aceptan override manual (`titles`): la app no conoce el tablero,
// así que el camino más largo real puede no coincidir con el conteo de caminos.
// `null` en el override = cálculo automático.
export const computeLargestArmy = (players, titles) => {
  if (titles?.largestArmy != null) return titles.largestArmy;
  let best = -1, who = null;
  players.forEach((p, i) => { if (p.knightsPlayed >= 3 && p.knightsPlayed > best) { best = p.knightsPlayed; who = i; } });
  return who;
};

export const computeLongestRoad = (players, titles) => {
  if (titles?.longestRoad != null) return titles.longestRoad;
  let best = -1, who = null;
  players.forEach((p, i) => { if (p.roadsBuilt >= 5 && p.roadsBuilt > best) { best = p.roadsBuilt; who = i; } });
  return who;
};

export const computeFinalScores = (players, titles) => {
  const scores = computeScores(players);
  const army = computeLargestArmy(players, titles);
  const road = computeLongestRoad(players, titles);
  return scores.map((s, i) => s + (army === i ? 2 : 0) + (road === i ? 2 : 0));
};

// Puntaje real: el público más las cartas de punto guardadas. Es el que
// decide la victoria; no se muestra a la mesa.
export const computeTrueScores = (players, titles) =>
  computeFinalScores(players, titles).map((s, i) => s + hiddenVP(players[i]));

export const WINNING_SCORE = 10;

// Quién ganó, si ganó alguien. La victoria se declara en el turno del jugador:
// los puntos solo suben en el turno propio, y así una carta de punto nunca
// delata a su dueño en el turno de otro.
export const findWinner = (state) => {
  if (!state.started) return -1;
  const scores = computeTrueScores(state.players, state.titles);
  if (scores[state.cp] >= WINNING_SCORE) return state.cp;
  // Red de seguridad: una corrección manual puede dejar a otro en 10 (por
  // ejemplo al reasignar un título). Igual se reconoce.
  return scores.findIndex(s => s >= WINNING_SCORE);
};

export const isGameFinished = (state) =>
  state.started && computeTrueScores(state.players, state.titles).some(s => s >= WINNING_SCORE);
