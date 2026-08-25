import { COSTS, RM, GAME_MODES, eHand, totalC, afford } from "./constants.js";

// ═══════════════════════════════════════════════
//  ESTADO DEL JUEGO — event sourcing
//
//  El estado se deriva de un log de acciones aplicadas en orden por
//  `gameReducer` (función pura). Toda la aleatoriedad ya resuelta viaja
//  dentro de la acción (dados tirados, mazo mezclado, carta robada), así
//  el replay del log es determinístico. Eso habilita: persistencia
//  (guardar el log), deshacer (recortar el log) y sync multi-dispositivo
//  (compartir el log).
//
//  Las acciones llevan `ts` (timestamp) para las entradas del log visible.
// ═══════════════════════════════════════════════

export const initialGameState = {
  started: false,
  gameMode: "full",
  players: [],
  cp: 0, // índice del jugador actual
  turnPhase: "preroll",
  dice: [0, 0],
  deck: [],
  robber: null, // número bloqueado
  turn: 1,
  diceHistory: [], // sums, newest first
  lastDistribution: null, // { num, lines: [{ci,name,items}] }
  log: [], // [{t, m}] newest first
  nextId: 1, // contador determinístico para ids de producciones
};

const pushLog = (log, ts, msg) => [{ t: ts, m: msg }, ...log].slice(0, 100);

// Ganancias por jugador para un número tirado (compartido con la UI para notifs)
export const computeGains = (players, num, robber) => {
  if (num === robber) return players.map(() => eHand());
  return players.map(p => {
    const gains = eHand();
    p.productions.forEach(pr => {
      if (pr.num === num) {
        const amt = pr.isCity ? 2 : 1;
        gains[pr.res] = (gains[pr.res] || 0) + amt;
      }
    });
    return gains;
  });
};

const subCost = (hand, cost) => {
  const nh = { ...hand };
  Object.entries(cost).forEach(([r, v]) => { nh[r] -= v; });
  return nh;
};

// Crea producciones para un poblado, consumiendo ids del contador del estado.
const buildProductions = (hexes, nextId) => {
  const gidVal = nextId++;
  const prods = hexes
    .filter(h => h.num && h.res)
    .map(h => ({ id: nextId++, num: parseInt(h.num), res: h.res, isCity: false, gid: gidVal }));
  return { prods, nextId };
};

export function gameReducer(state, action) {
  const { ts } = action;
  const mode = GAME_MODES[state.gameMode] || GAME_MODES.full;

  switch (action.type) {
    case "START_GAME": {
      // payload: { mode, players: [{name, ci}], settlements: {pi: [{hexes:[{num,res}]}]}, deck }
      let nextId = 1;
      const players = action.players.map((p, pi) => {
        const prods = [];
        (action.settlements[pi] || []).forEach(sett => {
          const r = buildProductions(sett.hexes, nextId);
          prods.push(...r.prods);
          nextId = r.nextId;
        });
        return {
          name: p.name, ci: p.ci, productions: prods, hand: eHand(),
          devCards: [], knightsPlayed: 0, roadsBuilt: 0,
          ports: [], devCardBought: [], devCardPlayed: false,
        };
      });
      return {
        ...initialGameState,
        started: true,
        gameMode: action.mode,
        players,
        deck: action.deck,
        nextId,
        log: pushLog([], ts, `🎲 Empieza ${players[0]?.name || "Jugador 1"}. ¡A jugar!`),
      };
    }

    case "ROLL": {
      const { d1, d2, manual } = action;
      const sum = d1 + d2;
      const name = state.players[state.cp]?.name;
      let log = pushLog(state.log, ts, manual
        ? `✍️ ${name} ingresó ${sum} manualmente`
        : `🎲 ${name} tiró ${d1} + ${d2} = ${sum}`);

      let players = state.players;
      let lastDistribution = state.lastDistribution;

      if (sum !== 7) {
        if (sum === state.robber) {
          log = pushLog(log, ts, `⛔ Ladrón bloquea el ${sum}`);
          lastDistribution = { num: sum, lines: [] };
        } else {
          const gainsByPlayer = computeGains(players, sum, state.robber);
          players = players.map((p, i) => {
            const gains = gainsByPlayer[i];
            const newHand = { ...p.hand };
            Object.entries(gains).forEach(([r, v]) => { newHand[r] += v; });
            return { ...p, hand: newHand };
          });
          const lines = [];
          gainsByPlayer.forEach((gains, i) => {
            const items = Object.entries(gains)
              .filter(([, v]) => v > 0)
              .map(([r, v]) => `+${v} ${RM[r].e} ${RM[r].n}`)
              .join(" ");
            if (items) {
              lines.push({ ci: state.players[i].ci, name: state.players[i].name, items });
              log = pushLog(log, ts, `📦 ${state.players[i].name}: ${items}`);
            }
          });
          if (lines.length === 0) log = pushLog(log, ts, `📦 Nadie produce con el ${sum}`);
          lastDistribution = { num: sum, lines };
        }
      }

      return {
        ...state,
        players,
        dice: [d1, d2],
        diceHistory: [sum, ...state.diceHistory].slice(0, 24),
        turnPhase: "rolled",
        lastDistribution,
        log,
      };
    }

    case "DISCARD": {
      // payload: { player, discards }
      const players = state.players.map((p, i) => {
        if (i !== action.player) return p;
        const nh = { ...p.hand };
        Object.entries(action.discards).forEach(([r, v]) => { nh[r] -= v; });
        return { ...p, hand: nh };
      });
      const items = Object.entries(action.discards).filter(([, v]) => v > 0).map(([r, v]) => `${v}${RM[r].e}`).join(" ");
      return { ...state, players, log: pushLog(state.log, ts, `🗑️ ${state.players[action.player].name} descartó ${items}`) };
    }

    case "PLACE_ROBBER":
      return { ...state, robber: action.num, log: pushLog(state.log, ts, `🦹 Ladrón colocado en el ${action.num}`) };

    case "STEAL": {
      // payload: { victim, res } — res elegido al azar en el dispatch
      const players = state.players.map((p, i) => {
        if (i === action.victim) { const nh = { ...p.hand }; nh[action.res]--; return { ...p, hand: nh }; }
        if (i === state.cp) { const nh = { ...p.hand }; nh[action.res]++; return { ...p, hand: nh }; }
        return p;
      });
      return { ...state, players, log: pushLog(state.log, ts, `🦹 ${state.players[state.cp].name} robó 1${RM[action.res].e} a ${state.players[action.victim].name}`) };
    }

    case "BUILD_ROAD": {
      const cost = COSTS.camino;
      if (mode.enforceCosts && !afford(state.players[state.cp].hand, cost)) return state;
      const players = state.players.map((p, i) => {
        if (i !== state.cp) return p;
        return { ...p, hand: mode.enforceCosts ? subCost(p.hand, cost) : p.hand, roadsBuilt: p.roadsBuilt + 1 };
      });
      return { ...state, players, log: pushLog(state.log, ts, `🛤️ ${state.players[state.cp].name} construyó un camino (total: ${state.players[state.cp].roadsBuilt + 1})`) };
    }

    case "ADD_SETTLEMENT": {
      // payload: { hexes }
      const cost = COSTS.poblado;
      if (mode.enforceCosts && !afford(state.players[state.cp].hand, cost)) return state;
      const { prods, nextId } = buildProductions(action.hexes, state.nextId);
      const players = state.players.map((p, i) => {
        if (i !== state.cp) return p;
        return {
          ...p,
          hand: mode.enforceCosts ? subCost(p.hand, cost) : p.hand,
          productions: [...p.productions, ...prods],
        };
      });
      return { ...state, players, nextId, log: pushLog(state.log, ts, `🏠 ${state.players[state.cp].name} construyó un poblado`) };
    }

    case "UPGRADE_CITY": {
      // payload: { gid }
      const cost = COSTS.ciudad;
      if (mode.enforceCosts && !afford(state.players[state.cp].hand, cost)) return state;
      const players = state.players.map((p, i) => {
        if (i !== state.cp) return p;
        return {
          ...p,
          hand: mode.enforceCosts ? subCost(p.hand, cost) : p.hand,
          productions: p.productions.map(pr => pr.gid === action.gid ? { ...pr, isCity: true } : pr),
        };
      });
      return { ...state, players, log: pushLog(state.log, ts, `🏙️ ${state.players[state.cp].name} mejoró a ciudad`) };
    }

    case "BUY_DEV": {
      const cost = COSTS.desarrollo;
      if (state.deck.length === 0) return state;
      if (mode.enforceCosts && !afford(state.players[state.cp].hand, cost)) return state;
      const card = state.deck[0];
      const players = state.players.map((p, i) => {
        if (i !== state.cp) return p;
        return {
          ...p,
          hand: mode.enforceCosts ? subCost(p.hand, cost) : p.hand,
          devCards: [...p.devCards, card],
          devCardBought: [...p.devCardBought, card],
        };
      });
      return { ...state, players, deck: state.deck.slice(1), log: pushLog(state.log, ts, `🃏 ${state.players[state.cp].name} compró carta de desarrollo`) };
    }

    case "PLAY_DEV": {
      // payload: { card, cardIdx } — el efecto de monopolio/abundancia llega en acciones aparte
      const { card, cardIdx } = action;
      const cur = state.players[state.cp];
      if (cur.devCardBought.includes(card) && card !== "victoria") return state;
      if (cur.devCardPlayed && card !== "victoria") return state;

      const removeCard = (p) => { const dc = [...p.devCards]; dc.splice(cardIdx, 1); return dc; };
      let players = state.players;
      let log = state.log;

      if (card === "caballero") {
        players = players.map((p, i) => i !== state.cp ? p : ({ ...p, devCards: removeCard(p), knightsPlayed: p.knightsPlayed + 1, devCardPlayed: true }));
        log = pushLog(log, ts, `⚔️ ${cur.name} jugó Caballero (total: ${cur.knightsPlayed + 1})`);
      } else if (card === "monopolio" || card === "abundancia") {
        players = players.map((p, i) => i !== state.cp ? p : ({ ...p, devCards: removeCard(p), devCardPlayed: true }));
      } else if (card === "caminos") {
        players = players.map((p, i) => i !== state.cp ? p : ({ ...p, devCards: removeCard(p), roadsBuilt: p.roadsBuilt + 2, devCardPlayed: true }));
        log = pushLog(log, ts, `🛤️ ${cur.name} jugó Construcción (+2 caminos, total: ${cur.roadsBuilt + 2})`);
      } else {
        return state;
      }
      return { ...state, players, log };
    }

    case "MONOPOLY": {
      // payload: { res }
      let stolen = 0;
      const updated = state.players.map(p => ({ ...p }));
      state.players.forEach((p, i) => {
        if (i === state.cp) return;
        stolen += p.hand[action.res];
        updated[i] = { ...updated[i], hand: { ...p.hand, [action.res]: 0 } };
      });
      updated[state.cp] = { ...updated[state.cp], hand: { ...updated[state.cp].hand, [action.res]: updated[state.cp].hand[action.res] + stolen } };
      return { ...state, players: updated, log: pushLog(state.log, ts, `👑 ${state.players[state.cp].name} jugó Monopolio (${RM[action.res].n}): robó ${stolen}`) };
    }

    case "YEAR_OF_PLENTY": {
      // payload: { res, last } — se despacha dos veces; `last` agrega la línea al log
      const players = state.players.map((p, i) => {
        if (i !== state.cp) return p;
        return { ...p, hand: { ...p.hand, [action.res]: p.hand[action.res] + 1 } };
      });
      const log = action.last ? pushLog(state.log, ts, `🎁 ${state.players[state.cp].name} jugó Abundancia`) : state.log;
      return { ...state, players, log };
    }

    case "TRADE_BANK": {
      // payload: { give, receive, ratio }
      const players = state.players.map((p, i) => {
        if (i !== state.cp) return p;
        const nh = { ...p.hand };
        nh[action.give] -= action.ratio;
        nh[action.receive] += 1;
        return { ...p, hand: nh };
      });
      return { ...state, players, log: pushLog(state.log, ts, `🔄 ${state.players[state.cp].name} cambió ${action.ratio}${RM[action.give].e} por 1${RM[action.receive].e}`) };
    }

    case "TRADE_PLAYER": {
      // payload: { other, give, receive }
      const players = state.players.map((p, i) => {
        if (i === state.cp) {
          const nh = { ...p.hand };
          Object.entries(action.give).forEach(([r, v]) => { nh[r] -= v; });
          Object.entries(action.receive).forEach(([r, v]) => { nh[r] += v; });
          return { ...p, hand: nh };
        }
        if (i === action.other) {
          const nh = { ...p.hand };
          Object.entries(action.give).forEach(([r, v]) => { nh[r] += v; });
          Object.entries(action.receive).forEach(([r, v]) => { nh[r] -= v; });
          return { ...p, hand: nh };
        }
        return p;
      });
      return { ...state, players, log: pushLog(state.log, ts, `🤝 ${state.players[state.cp].name} comerció con ${state.players[action.other].name}`) };
    }

    case "ADD_PORT": {
      const players = state.players.map((p, i) => {
        if (i !== state.cp) return p;
        if (p.ports.includes(action.port)) return p;
        return { ...p, ports: [...p.ports, action.port] };
      });
      return { ...state, players };
    }

    case "REMOVE_PORT": {
      const players = state.players.map((p, i) => {
        if (i !== state.cp) return p;
        return { ...p, ports: p.ports.filter(pt => pt !== action.port) };
      });
      return { ...state, players };
    }

    case "ADD_FREE_SETTLEMENT": {
      // payload: { player, hexes }
      const { prods, nextId } = buildProductions(action.hexes, state.nextId);
      const players = state.players.map((p, i) => {
        if (i !== action.player) return p;
        return { ...p, productions: [...p.productions, ...prods] };
      });
      return { ...state, players, nextId, log: pushLog(state.log, ts, `🏠 Se agregó un poblado a ${state.players[action.player].name}`) };
    }

    case "MANUAL_ADJUST": {
      // payload: { player, res, delta }
      const players = state.players.map((p, i) => {
        if (i !== action.player) return p;
        const nh = { ...p.hand };
        nh[action.res] = Math.max(0, nh[action.res] + action.delta);
        return { ...p, hand: nh };
      });
      return { ...state, players };
    }

    case "MOVE_PLAYER": {
      // payload: { idx, dir }
      const newIdx = action.idx + action.dir;
      if (newIdx < 0 || newIdx >= state.players.length) return state;
      const players = [...state.players];
      [players[action.idx], players[newIdx]] = [players[newIdx], players[action.idx]];
      let cp = state.cp;
      if (cp === action.idx) cp = newIdx;
      else if (cp === newIdx) cp = action.idx;
      return { ...state, players, cp };
    }

    case "END_TURN": {
      const players = state.players.map((p, i) => i === state.cp ? { ...p, devCardBought: [], devCardPlayed: false } : p);
      const next = (state.cp + 1) % state.players.length;
      return {
        ...state,
        players,
        cp: next,
        turnPhase: "preroll",
        dice: [0, 0],
        turn: next === 0 ? state.turn + 1 : state.turn,
        log: pushLog(state.log, ts, `➡️ Turno de ${state.players[next].name}`),
      };
    }

    default:
      return state;
  }
}

// Reconstruye el estado desde un log de acciones (persistencia, undo, sync).
export const replayActions = (actions) => actions.reduce(gameReducer, initialGameState);
