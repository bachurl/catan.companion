// Valores derivados del estado del juego (funciones puras).

export const computeScores = (players) => players.map(p => {
  const grp = {};
  p.productions.forEach(pr => {
    if (!grp[pr.gid]) grp[pr.gid] = false;
    if (pr.isCity) grp[pr.gid] = true;
  });
  const sett = Object.values(grp).filter(c => !c).length;
  const cit = Object.values(grp).filter(c => c).length;
  return sett + cit * 2 + p.devCards.filter(c => c === "victoria").length;
});

export const computeLargestArmy = (players) => {
  let best = -1, who = null;
  players.forEach((p, i) => { if (p.knightsPlayed >= 3 && p.knightsPlayed > best) { best = p.knightsPlayed; who = i; } });
  return who;
};

export const computeLongestRoad = (players) => {
  let best = -1, who = null;
  players.forEach((p, i) => { if (p.roadsBuilt >= 5 && p.roadsBuilt > best) { best = p.roadsBuilt; who = i; } });
  return who;
};

export const computeFinalScores = (players) => {
  const scores = computeScores(players);
  const army = computeLargestArmy(players);
  const road = computeLongestRoad(players);
  return scores.map((s, i) => s + (army === i ? 2 : 0) + (road === i ? 2 : 0));
};

export const WINNING_SCORE = 10;

export const isGameFinished = (state) =>
  state.started && computeFinalScores(state.players).some(s => s >= WINNING_SCORE);
