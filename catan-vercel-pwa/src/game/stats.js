// ═══════════════════════════════════════════════
//  ESTADÍSTICAS DE LA PARTIDA
//
//  Se derivan del log de acciones, no de contadores en el estado: replayando
//  el log y mirando el antes/después de cada acción se reconstruye todo lo
//  que el estado final ya no recuerda (cuánto produjo cada uno, qué le robaron,
//  cuánto le bloqueó el ladrón, cómo evolucionó el puntaje).
//
//  Que sea una función pura del log tiene tres consecuencias buenas:
//   · Deshacer y resync funcionan gratis (mismo log ⇒ mismas estadísticas).
//   · Las partidas ya guardadas muestran estadísticas completas hacia atrás,
//     sin migrar nada.
//   · Se puede llamar en cualquier momento: las estadísticas son de la partida
//     en curso, no del final.
// ═══════════════════════════════════════════════
import {
  gameReducer, initialGameState, effectiveActions,
  computeGains, robberNum,
} from "./reducer.js";
import { eHand, totalC, numberProb, RES } from "./constants.js";
import { computeFinalScores } from "./selectors.js";

const emptyPlayerStats = () => ({
  produced: eHand(),      // recursos cobrados por tiradas
  producedTotal: 0,
  blocked: 0,             // recursos que le comió el ladrón
  gained: 0,              // entradas que no son producción (robos a favor, monopolio, abundancia)
  lost: 0,                // salidas que no son gasto (descartes, robos en contra, monopolio)
  discarded: 0,           // cartas tiradas por un 7
  robbedByOthers: 0,      // veces que le robaron
  stolenFromOthers: 0,    // veces que robó
  spent: 0,               // recursos gastados en construir/comprar
  roads: 0, settlements: 0, cities: 0,
  devBought: 0, devPlayed: 0, knights: 0,
  tradesBank: 0, tradesPlayer: 0,
  rolls: 0, sevens: 0,    // tiradas propias
  turns: 0,
});

// Recursos que el jugador cobraría con ese número si no hubiera ladrón.
const gainsTotal = (gains) => Object.values(gains).reduce((a, b) => a + b, 0);

// Fuerza de la posición: suma de puntos de probabilidad de los hexágonos
// (un 6 vale 5, un 2 vale 1), contando doble las ciudades. Es lo que la mesa
// llama "cuántos dados tenés": se deriva del estado actual.
const pipCount = (player) =>
  player.productions.reduce((acc, pr) => acc + numberProb(Number(pr.num)) * (pr.isCity ? 2 : 1), 0);

// Cantidad de poblados y ciudades a partir de las producciones agrupadas por gid.
const countBuildings = (player) => {
  const byGid = {};
  player.productions.forEach(pr => {
    if (!(pr.gid in byGid)) byGid[pr.gid] = false;
    if (pr.isCity) byGid[pr.gid] = true;
  });
  const vals = Object.values(byGid);
  return { settlements: vals.filter(c => !c).length, cities: vals.filter(c => c).length };
};

export function computeMatchStats(actions) {
  const eff = effectiveActions(actions || []);
  let state = initialGameState;
  let stats = [];
  const timeline = [];   // evolución del puntaje por ronda
  let lastRound = null;
  // Tiradas desde el último 7. El estado solo guarda las últimas 24 tiradas,
  // así que la cuenta exacta sale de recorrer el log completo.
  let sinceSeven = 0;
  let sawSeven = false;

  const fit = () => {
    // El log puede agregar jugadores (CREATE_LOBBY / START_GAME): el array de
    // estadísticas acompaña la cantidad de asientos.
    while (stats.length < state.players.length) stats.push(emptyPlayerStats());
    stats.length = state.players.length;
  };

  const pushTimeline = (round, st) => {
    if (!st.started || st.players.length === 0) return;
    const scores = computeFinalScores(st.players, st.titles);
    const last = timeline[timeline.length - 1];
    if (last && last.round === round) { last.scores = scores; return; }
    timeline.push({ round, scores });
  };

  for (const action of eff) {
    const prev = state;
    const next = gameReducer(prev, action);
    state = next;
    fit();

    // El reducer devuelve el mismo objeto cuando rechaza una acción (no alcanza
    // para pagar, mazo vacío, fuera de fase): esas no cuentan para nada.
    if (next === prev) continue;

    const cp = prev.cp;
    const at = (i) => stats[i];
    // Gasto: lo que salió de la mano de un jugador al construir o comprar.
    const spentBy = (i) => {
      const before = prev.players[i] ? totalC(prev.players[i].hand) : 0;
      const after = next.players[i] ? totalC(next.players[i].hand) : 0;
      return Math.max(0, before - after);
    };

    switch (action.type) {
      case "START_GAME":
      case "BEGIN_GAME":
        stats = state.players.map(emptyPlayerStats);
        lastRound = next.turn;
        pushTimeline(next.turn, next);
        break;

      case "ROLL": {
        const sum = action.d1 + action.d2;
        if (at(cp)) { at(cp).rolls++; if (sum === 7) at(cp).sevens++; }
        if (sum === 7) { sinceSeven = 0; sawSeven = true; } else sinceSeven++;
        if (sum !== 7) {
          const withRobber = computeGains(prev.players, sum, prev.robber);
          // Sin ladrón: la diferencia es exactamente lo que bloqueó.
          const noRobber = robberNum(prev.robber) === sum
            ? computeGains(prev.players, sum, null)
            : withRobber;
          withRobber.forEach((gains, i) => {
            const s = at(i);
            if (!s) return;
            Object.entries(gains).forEach(([r, v]) => { s.produced[r] += v; });
            s.producedTotal += gainsTotal(gains);
            s.blocked += gainsTotal(noRobber[i]) - gainsTotal(gains);
          });
        }
        break;
      }

      case "DISCARD": {
        const s = at(action.player);
        if (s) {
          const n = spentBy(action.player);
          s.discarded += n;
          s.lost += n;
        }
        break;
      }

      case "STEAL": {
        if (at(cp)) { at(cp).stolenFromOthers++; at(cp).gained++; }
        if (at(action.victim)) { at(action.victim).robbedByOthers++; at(action.victim).lost++; }
        break;
      }

      case "MONOPOLY": {
        next.players.forEach((_, i) => {
          const s = at(i);
          if (!s) return;
          const delta = totalC(next.players[i].hand) - totalC(prev.players[i].hand);
          if (delta > 0) s.gained += delta;
          else if (delta < 0) s.lost += -delta;
        });
        break;
      }

      case "YEAR_OF_PLENTY":
        if (at(cp)) at(cp).gained++;
        break;

      case "BUILD_ROAD": {
        const pi = action.player ?? cp;
        if (at(pi)) { at(pi).roads++; at(pi).spent += spentBy(pi); }
        break;
      }

      case "ADD_SETTLEMENT": {
        const pi = action.player ?? cp;
        if (at(pi)) { at(pi).settlements++; at(pi).spent += spentBy(pi); }
        break;
      }

      case "UPGRADE_CITY": {
        const pi = action.player ?? cp;
        if (at(pi)) { at(pi).cities++; at(pi).spent += spentBy(pi); }
        break;
      }

      // Correcciones de la mesa: la app no vio la construcción, pero pasó.
      case "ADD_FREE_SETTLEMENT": {
        const s = at(action.player);
        if (s) { if (action.isCity) s.cities++; else s.settlements++; }
        break;
      }

      case "UPGRADE_CITY_FREE": {
        const s = at(action.player);
        if (s) s.cities++;
        break;
      }

      case "BUY_DEV": {
        const pi = action.player ?? cp;
        if (at(pi)) { at(pi).devBought++; at(pi).spent += spentBy(pi); }
        break;
      }

      case "PLAY_DEV": {
        const s = at(cp);
        if (s) {
          s.devPlayed++;
          if (action.card === "caballero") s.knights++;
        }
        break;
      }

      case "TRADE_BANK":
        if (at(cp)) at(cp).tradesBank++;
        break;

      case "TRADE_PLAYER":
        if (at(cp)) at(cp).tradesPlayer++;
        if (at(action.other)) at(action.other).tradesPlayer++;
        break;

      case "MOVE_PLAYER": {
        // Reordenar asientos mueve también las estadísticas: siguen al jugador.
        const a = action.idx, b = action.idx + action.dir;
        if (stats[a] && stats[b]) [stats[a], stats[b]] = [stats[b], stats[a]];
        break;
      }

      case "END_TURN": {
        if (at(cp)) at(cp).turns++;
        if (next.turn !== lastRound) {
          pushTimeline(next.turn, next);
          lastRound = next.turn;
        }
        break;
      }

      default:
        break;
    }
  }

  // Punto final: el estado de ahora, para que el gráfico llegue hasta el presente.
  if (state.started) pushTimeline(state.turn, state);

  const players = state.players.map((p, i) => {
    const s = stats[i] || emptyPlayerStats();
    const buildings = countBuildings(p);
    const best = RES
      .map(r => ({ res: r.id, n: s.produced[r.id] || 0 }))
      .sort((a, b) => b.n - a.n)[0];
    return {
      ...s,
      // El conteo de edificios del estado manda sobre el acumulado: refleja el
      // tablero incluso si una partida se retomó o se corrigió a mano.
      settlementsNow: buildings.settlements,
      citiesNow: buildings.cities,
      pips: pipCount(p),
      handSize: totalC(p.hand),
      devInHand: p.devCards.length,
      topResource: best && best.n > 0 ? best.res : null,
    };
  });

  const rollCount = state.rollCount || 0;
  const diceRows = Array.from({ length: 11 }, (_, k) => {
    const n = k + 2;
    const count = state.diceTotals?.[n] || 0;
    const expected = rollCount * (numberProb(n) / 36);
    return { n, count, expected, diff: count - expected };
  });
  // El 7 queda afuera de "más/menos salió": no produce recursos, mueve el
  // ladrón. Compararlo con los números de producción no dice nada útil (y al
  // tener la probabilidad más alta siempre aparecía como el más "frío").
  const sortedByDiff = diceRows.filter(r => r.n !== 7).sort((a, b) => b.diff - a.diff);

  return {
    started: state.started,
    round: state.turn,
    rollCount,
    players,
    timeline,
    dice: {
      rows: diceRows,
      total: rollCount,
      hot: rollCount > 0 ? sortedByDiff[0] : null,
      cold: rollCount > 0 ? sortedByDiff[sortedByDiff.length - 1] : null,
      sevens: state.diceTotals?.[7] || 0,
      // Tiradas desde el último 7; null si todavía no salió ninguno.
      since7: sawSeven ? sinceSeven : null,
    },
    // Total producido en la mesa, por recurso: para el gráfico de producción.
    tableProduced: RES.reduce((acc, r) => {
      acc[r.id] = players.reduce((sum, p) => sum + (p.produced[r.id] || 0), 0);
      return acc;
    }, {}),
  };
}
