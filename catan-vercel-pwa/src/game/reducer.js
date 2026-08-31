import { COSTS, RM, DC, GAME_MODES, eHand, totalC, afford } from "./constants.js";

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
  inLobby: false, // sala online creada, esperando que cada jugador cargue sus datos
  gameMode: "full",
  expansion: false, // 5-6 jugadores: habilita construir en turno ajeno
  players: [],
  cp: 0, // índice del jugador actual
  turnPhase: "preroll",
  dice: [0, 0],
  deck: [],
  robber: null, // { num, res } — res null = bloquea todo el número (acciones viejas)
  turn: 1, // ronda (avanza al completar la vuelta)
  rollCount: 0, // tiradas totales de la partida
  diceTotals: {}, // { 2..12: veces } acumulado sin recorte
  titles: { longestRoad: null, largestArmy: null }, // override manual (null = automático)
  diceHistory: [], // sums, newest first
  lastDistribution: null, // { num, lines: [{ci,name,items}] }
  log: [], // [{t, m}] newest first
  nextId: 1, // contador determinístico para ids de producciones
};

const pushLog = (log, ts, msg) => [{ t: ts, m: msg }, ...log].slice(0, 100);

// El ladrón se guarda como { num, res }; las acciones viejas traían solo el
// número (y bloqueaban todos los hexágonos de ese número).
export const robberNum = (robber) => (robber == null ? null : (typeof robber === "object" ? robber.num : robber));
export const robberRes = (robber) => (robber && typeof robber === "object" ? robber.res : null);
// Jugadores lindantes al hexágono bloqueado. null = todos los que tengan ese
// número/recurso (acciones viejas, o cuando no hace falta desambiguar).
export const robberPlayers = (robber) =>
  (robber && typeof robber === "object" && Array.isArray(robber.players) ? robber.players : null);
export const robberLabel = (robber) => {
  const n = robberNum(robber);
  if (n == null) return null;
  const r = robberRes(robber);
  return r ? `${n} ${RM[r]?.e || ""}` : `${n}`;
};

// Ganancias por jugador para un número tirado (compartido con la UI para notifs).
//
// El ladrón bloquea UN hexágono. La app no tiene modelo del tablero: la
// producción de cada jugador se guarda por separado, así que dos "8 madera" de
// jugadores distintos pueden ser el mismo hexágono o dos diferentes. Por eso el
// hexágono se identifica por número + recurso + a qué jugadores toca: así el 8
// que bloquea a 1 y 2 no es el mismo que el 8 que bloquea a 2 y 3.
// Con `res` o `players` en null se cae al comportamiento amplio (todo ese
// número, o todos los jugadores con ese hexágono).
export const computeGains = (players, num, robber) => {
  const rNum = robberNum(robber), rRes = robberRes(robber), rPlayers = robberPlayers(robber);
  return players.map((p, pi) => {
    const gains = eHand();
    const blocksPlayer = rNum === num && (rPlayers === null || rPlayers.includes(pi));
    p.productions.forEach(pr => {
      if (pr.num !== num) return;
      if (blocksPlayer && (rRes === null || pr.res === rRes)) return; // bloqueado
      gains[pr.res] = (gains[pr.res] || 0) + (pr.isCity ? 2 : 1);
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
    // ── LOBBY ONLINE ──
    // El host crea la sala apenas elige modo y cantidad; cada jugador carga
    // su nombre/color y poblados iniciales desde su celular, y el host
    // comienza la partida con BEGIN_GAME.
    case "CREATE_LOBBY": {
      // payload: { mode, playerCount, deck }
      const players = Array.from({ length: action.playerCount }, (_, i) => ({
        name: `Jugador ${i + 1}`, ci: i, productions: [], hand: eHand(),
        devCards: [], knightsPlayed: 0, roadsBuilt: 0,
        ports: [], devCardBought: [], devCardPlayed: false,
      }));
      return { ...initialGameState, inLobby: true, gameMode: action.mode, expansion: !!action.expansion, players, deck: action.deck };
    }

    case "SET_PLAYER_NAME": {
      // payload: { player, name?, ci? }
      const players = state.players.map((p, i) => i !== action.player ? p : ({
        ...p,
        name: action.name ?? p.name,
        ci: action.ci ?? p.ci,
      }));
      return { ...state, players };
    }

    case "SET_INITIAL_SETTLEMENTS": {
      // payload: { player, settlements: [{hexes:[{num,res}]}] }
      // Reemplaza los poblados iniciales del jugador (editable hasta empezar).
      if (state.started) return state;
      let nextId = state.nextId;
      const prods = [];
      (action.settlements || []).forEach(sett => {
        const r = buildProductions(sett.hexes, nextId);
        prods.push(...r.prods);
        nextId = r.nextId;
      });
      const players = state.players.map((p, i) => i !== action.player ? p : ({ ...p, productions: prods }));
      return { ...state, players, nextId };
    }

    case "BEGIN_GAME": {
      if (state.started || !state.inLobby) return state;
      return {
        ...state,
        started: true,
        inLobby: false,
        log: pushLog(state.log, ts, `🎲 Empieza ${state.players[0]?.name || "Jugador 1"}. ¡A jugar!`),
      };
    }

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
        expansion: !!action.expansion,
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
        if (robberNum(state.robber) === sum) {
          log = pushLog(log, ts, `⛔ Ladrón bloquea el ${robberLabel(state.robber)}`);
        }
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

      return {
        ...state,
        players,
        dice: [d1, d2],
        diceHistory: [sum, ...state.diceHistory].slice(0, 24),
        rollCount: (state.rollCount || 0) + 1,
        diceTotals: { ...state.diceTotals, [sum]: (state.diceTotals?.[sum] || 0) + 1 },
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

    case "PLACE_ROBBER": {
      // payload: { num, res?, players? } — identifica el hexágono. Sin res
      // bloquea todo el número; sin players, a todos los que lo tengan.
      const robber = {
        num: action.num,
        res: action.res ?? null,
        players: Array.isArray(action.players) ? action.players : null,
      };
      const blocked = robber.players
        ? robber.players.map(i => state.players[i]?.name).filter(Boolean).join(", ")
        : null;
      return {
        ...state,
        robber,
        log: pushLog(state.log, ts, `🦹 Ladrón colocado en el ${robberLabel(robber)}${blocked ? ` (bloquea a ${blocked})` : ""}`),
      };
    }

    case "STEAL": {
      // payload: { victim, res } — res elegido al azar en el dispatch
      const players = state.players.map((p, i) => {
        if (i === action.victim) { const nh = { ...p.hand }; nh[action.res]--; return { ...p, hand: nh }; }
        if (i === state.cp) { const nh = { ...p.hand }; nh[action.res]++; return { ...p, hand: nh }; }
        return p;
      });
      return { ...state, players, log: pushLog(state.log, ts, `🦹 ${state.players[state.cp].name} robó 1${RM[action.res].e} a ${state.players[action.victim].name}`) };
    }

    // Las construcciones llevan `player` explícito: en la expansión 5-6 se
    // puede construir en el turno de otro (fase de construcción especial).
    // Sin `player`, construye el jugador de turno (acciones viejas).
    case "BUILD_ROAD": {
      const pi = action.player ?? state.cp;
      const cost = COSTS.camino;
      if (mode.enforceCosts && !afford(state.players[pi].hand, cost)) return state;
      const players = state.players.map((p, i) => {
        if (i !== pi) return p;
        return { ...p, hand: mode.enforceCosts ? subCost(p.hand, cost) : p.hand, roadsBuilt: p.roadsBuilt + 1 };
      });
      return { ...state, players, log: pushLog(state.log, ts, `🛤️ ${state.players[pi].name} construyó un camino (total: ${state.players[pi].roadsBuilt + 1})`) };
    }

    case "ADD_SETTLEMENT": {
      // payload: { hexes, player? }
      const pi = action.player ?? state.cp;
      const cost = COSTS.poblado;
      if (mode.enforceCosts && !afford(state.players[pi].hand, cost)) return state;
      const { prods, nextId } = buildProductions(action.hexes, state.nextId);
      const players = state.players.map((p, i) => {
        if (i !== pi) return p;
        return {
          ...p,
          hand: mode.enforceCosts ? subCost(p.hand, cost) : p.hand,
          productions: [...p.productions, ...prods],
        };
      });
      return { ...state, players, nextId, log: pushLog(state.log, ts, `🏠 ${state.players[pi].name} construyó un poblado`) };
    }

    case "UPGRADE_CITY": {
      // payload: { gid, player? }
      const pi = action.player ?? state.cp;
      const cost = COSTS.ciudad;
      if (mode.enforceCosts && !afford(state.players[pi].hand, cost)) return state;
      const players = state.players.map((p, i) => {
        if (i !== pi) return p;
        return {
          ...p,
          hand: mode.enforceCosts ? subCost(p.hand, cost) : p.hand,
          productions: p.productions.map(pr => pr.gid === action.gid ? { ...pr, isCity: true } : pr),
        };
      });
      return { ...state, players, log: pushLog(state.log, ts, `🏙️ ${state.players[pi].name} mejoró a ciudad`) };
    }

    case "BUY_DEV": {
      // payload: { card?, player? } — con mazo físico se elige la carta que
      // salió; sin `card` se toma el tope del mazo virtual (acciones viejas).
      const pi = action.player ?? state.cp;
      const cost = COSTS.desarrollo;
      const card = action.card ?? state.deck[0];
      if (!card) return state; // mazo virtual vacío y sin carta explícita
      if (mode.enforceCosts && !afford(state.players[pi].hand, cost)) return state;
      // Descuenta esa carta del mazo virtual si todavía figuraba.
      const di = state.deck.indexOf(card);
      const deck = di >= 0 ? [...state.deck.slice(0, di), ...state.deck.slice(di + 1)] : state.deck;
      const players = state.players.map((p, i) => {
        if (i !== pi) return p;
        return {
          ...p,
          hand: mode.enforceCosts ? subCost(p.hand, cost) : p.hand,
          devCards: [...p.devCards, card],
          devCardBought: [...p.devCardBought, card],
        };
      });
      return { ...state, players, deck, log: pushLog(state.log, ts, `🃏 ${state.players[pi].name} compró ${DC[card]?.e || ""} ${DC[card]?.n || "carta de desarrollo"}`) };
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
      // payload: { player, hexes, isCity? } — corrección sin costo
      const { prods, nextId } = buildProductions(action.hexes, state.nextId);
      const finalProds = action.isCity ? prods.map(pr => ({ ...pr, isCity: true })) : prods;
      const players = state.players.map((p, i) => {
        if (i !== action.player) return p;
        return { ...p, productions: [...p.productions, ...finalProds] };
      });
      return { ...state, players, nextId, log: pushLog(state.log, ts, `${action.isCity ? "🏙️ Se agregó una ciudad" : "🏠 Se agregó un poblado"} a ${state.players[action.player].name}`) };
    }

    case "UPGRADE_CITY_FREE": {
      // payload: { player, gid } — corrección sin costo, para cualquier jugador
      const players = state.players.map((p, i) => {
        if (i !== action.player) return p;
        return { ...p, productions: p.productions.map(pr => pr.gid === action.gid ? { ...pr, isCity: true } : pr) };
      });
      return { ...state, players, log: pushLog(state.log, ts, `🏙️ ${state.players[action.player].name}: poblado marcado como ciudad`) };
    }

    case "ADJUST_DEV": {
      // payload: { player, card, delta } — corrección de cartas de desarrollo
      // (el mazo físico de la mesa manda sobre el mazo virtual).
      let changed = false;
      const players = state.players.map((p, i) => {
        if (i !== action.player) return p;
        const dc = [...p.devCards];
        if (action.delta > 0) { dc.push(action.card); changed = true; }
        else {
          const idx = dc.lastIndexOf(action.card);
          if (idx === -1) return p;
          dc.splice(idx, 1);
          changed = true;
        }
        return { ...p, devCards: dc };
      });
      if (!changed) return state;
      const verb = action.delta > 0 ? "+1" : "−1";
      return { ...state, players, log: pushLog(state.log, ts, `🃏 ${state.players[action.player].name}: ${verb} ${DC[action.card]?.e || ""} ${DC[action.card]?.n || action.card}`) };
    }

    case "ADJUST_STAT": {
      // payload: { player, stat: "knightsPlayed" | "roadsBuilt", delta }
      if (action.stat !== "knightsPlayed" && action.stat !== "roadsBuilt") return state;
      const players = state.players.map((p, i) =>
        i !== action.player ? p : ({ ...p, [action.stat]: Math.max(0, p[action.stat] + action.delta) }));
      return { ...state, players };
    }

    case "SET_TITLE": {
      // payload: { title: "longestRoad" | "largestArmy", player: idx | null }
      // null vuelve al cálculo automático.
      if (action.title !== "longestRoad" && action.title !== "largestArmy") return state;
      const titles = { ...state.titles, [action.title]: action.player };
      const emoji = action.title === "longestRoad" ? "🛤️" : "⚔️";
      const label = action.title === "longestRoad" ? "Camino más largo" : "Ejército más grande";
      const msg = action.player === null
        ? `${emoji} ${label}: vuelve al cálculo automático`
        : `${emoji} ${label} asignado a ${state.players[action.player]?.name}`;
      return { ...state, titles, log: pushLog(state.log, ts, msg) };
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
      // cp, los títulos manuales y el hexágono del ladrón referencian asientos:
      // siguen al jugador movido.
      const follow = (i) => (i === action.idx ? newIdx : i === newIdx ? action.idx : i);
      const titles = {
        longestRoad: state.titles?.longestRoad == null ? null : follow(state.titles.longestRoad),
        largestArmy: state.titles?.largestArmy == null ? null : follow(state.titles.largestArmy),
      };
      const rPlayers = robberPlayers(state.robber);
      const robber = rPlayers === null ? state.robber : { ...state.robber, players: rPlayers.map(follow) };
      return { ...state, players, cp: follow(state.cp), titles, robber };
    }

    case "END_TURN": {
      const next = (state.cp + 1) % state.players.length;
      // Se limpia para el que termina y para el que arranca: una carta comprada
      // en turno ajeno (fase de construcción especial) ya se puede jugar cuando
      // le toca a su dueño.
      const players = state.players.map((p, i) =>
        (i === state.cp || i === next) ? { ...p, devCardBought: [], devCardPlayed: false } : p);
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

// "UNDO" es un marcador en el log (no un case del reducer): al replayar,
// cada UNDO anula la última acción efectiva anterior. Modelar el deshacer
// como acción permite sincronizarlo en logs compartidos append-only.
export const effectiveActions = (actions) => {
  const eff = [];
  for (const a of actions) {
    if (a.type === "UNDO") eff.pop();
    else eff.push(a);
  }
  return eff;
};

// Reconstruye el estado desde un log de acciones (persistencia, undo, sync).
export const replayActions = (actions) => effectiveActions(actions).reduce(gameReducer, initialGameState);
