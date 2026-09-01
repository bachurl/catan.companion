import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { STYLE_CSS } from "./styles";
import { DiceFace, ResBadge } from "./components";
import StatsPanel, { DiceStats } from "./StatsPanel";
import {
  RES, RM, NUMS, COSTS, COST_NAMES, COST_EMOJI, INIT_DECK, DC, COLORS,
  playerMark, GAME_MODES, shuffle, rollDie, afford, totalC, eHand, dotStr,
} from "./game/constants";
import { computeGains, replayActions, effectiveActions, robberNum, robberRes, robberLabel } from "./game/reducer";
import { computeScores, computeFinalScores, computeTrueScores, computeLargestArmy, computeLongestRoad, hiddenVP, findWinner, WINNING_SCORE, isGameFinished } from "./game/selectors";
import { describeAction } from "./game/describe";
import { computeMatchStats } from "./game/stats";
import { loadHistory, archiveGame, deleteGame, clearHistory, isArchived } from "./game/history";
import { trackEvent, loadErrors, clearErrors, formatErrorsForReport } from "./telemetry";
import { useGameLog, loadSavedGame, clearSavedActions } from "./game/useGameLog";
import { useOnlineRoom, loadSavedRoomCode } from "./online/useOnlineRoom";
import { useGameHistory } from "./history/useGameHistory";
import { useWakeLock, vibrate } from "./useWakeLock";

// Acciones de juego que solo despacha el jugador de turno (o un celular "mesa"
// sin jugador reclamado). Las de corrección también las puede hacer el host.
const TURN_ACTIONS = new Set([
  "ROLL", "DISCARD", "PLACE_ROBBER", "STEAL", "BUILD_ROAD", "ADD_SETTLEMENT",
  "UPGRADE_CITY", "BUY_DEV", "PLAY_DEV", "MONOPOLY", "YEAR_OF_PLENTY",
  "TRADE_BANK", "TRADE_PLAYER", "ADD_PORT", "REMOVE_PORT", "END_TURN",
]);
const FIX_ACTIONS = new Set([
  "MANUAL_ADJUST", "ADD_FREE_SETTLEMENT", "UPGRADE_CITY_FREE", "ADJUST_DEV",
  "ADJUST_STAT", "SET_TITLE", "MOVE_PLAYER", "UNDO",
]);
// En el lobby, cada celular edita solo a su jugador (el host o la mesa, a cualquiera).
const LOBBY_ACTIONS = new Set(["SET_PLAYER_NAME", "SET_INITIAL_SETTLEMENTS"]);
// Construcciones: en la expansión 5-6 se permiten en turno ajeno, siempre que
// la acción sea para el propio jugador (fase de construcción especial).
const BUILD_ACTIONS = new Set(["BUILD_ROAD", "ADD_SETTLEMENT", "UPGRADE_CITY", "BUY_DEV"]);

// Agrupa las producciones de un jugador por poblado/ciudad (gid).
const getSettlementGroups = (p) => {
  const groups = {};
  p.productions.forEach(pr => {
    if (!groups[pr.gid]) groups[pr.gid] = { hexes: [], isCity: false, gid: pr.gid };
    groups[pr.gid].hexes.push(pr);
    if (pr.isCity) groups[pr.gid].isCity = true;
  });
  return Object.values(groups);
};

// Fecha de una partida del historial: corta y en local.
const fmtDate = (ts) => {
  try {
    return new Date(ts).toLocaleDateString("es-AR", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "";
  }
};

// Preferencia local: quien tira dados físicos ve el teclado 2-12 directo.
const PREF_MANUAL_KEY = "catan.dadosManuales.v1";
const loadPrefManual = () => { try { return localStorage.getItem(PREF_MANUAL_KEY) === "1"; } catch { return false; } };
const savePrefManual = (v) => { try { localStorage.setItem(PREF_MANUAL_KEY, v ? "1" : "0"); } catch { /* sin storage */ } };

// ═══════════════════════════════════════════════
//  APP PRINCIPAL
//  El estado del juego vive en useGameLog (reducer + log de acciones).
//  Acá queda solo el estado de UI: fase de setup, tabs, modales, notifs.
// ═══════════════════════════════════════════════
export default function CatanApp() {
  const { game, actions, dispatchAction, replaceActions, resetGame } = useGameLog();

  // ── SALA ONLINE ──
  // Acciones remotas se aplican con dispatchAction directo (sin re-publicar);
  // onResync reemplaza el log entero con el orden canónico del servidor.
  // Reordenar el turno mueve asientos, y quién controla cada asiento vive en
  // room_members: cada dispositivo solo puede corregir su propia fila, así que
  // el swap se aplica localmente en todos (el que lo hizo y los que lo reciben).
  const followMyClaimRef = useRef(null); // (action) => void, seteado más abajo
  const onRemoteAction = useCallback((action) => {
    const stamped = dispatchAction(action);
    if (action.type === "MOVE_PLAYER") followMyClaimRef.current?.(action);
    return stamped;
  }, [dispatchAction]);

  const online = useOnlineRoom({
    onRemoteAction,
    onResync: replaceActions,
  });

  // ── HISTORIAL EN LA NUBE ──
  // Historial en la nube (opcional): el archivo local lo maneja game/history.js.
  const cloud = useGameHistory();

  const [notif, setNotif] = useState(null);
  const notifTimer = useRef(null);
  const showNotif = useCallback((msg, dur = 3000) => {
    setNotif(msg);
    if (notifTimer.current) clearTimeout(notifTimer.current);
    notifTimer.current = setTimeout(() => setNotif(null), dur);
  }, []);

  // Toda acción local pasa por acá: se aplica al instante y, si hay sala,
  // se publica (con cola offline si no hay red).
  // Gating por turno: en una sala, un celular con jugador reclamado solo
  // actúa en su turno; correcciones (ajustes, deshacer) también las hace el
  // host. Un celular sin jugador reclamado controla la mesa completa.
  const dispatch = useCallback((action) => {
    if (online.room && online.myPlayerIndex !== null) {
      if (!game.started) {
        // Lobby: cada uno edita su propio jugador; el host (o un celular sin
        // jugador reclamado) puede editar a cualquiera y comenzar la partida.
        if (LOBBY_ACTIONS.has(action.type) && action.player !== online.myPlayerIndex && !online.room.isHost) {
          showNotif("Solo podés editar tu propio jugador");
          return null;
        }
        if (action.type === "BEGIN_GAME" && !online.room.isHost) {
          showNotif("Solo el anfitrión puede comenzar la partida");
          return null;
        }
        if (action.type === "MOVE_PLAYER" && !online.room.isHost) {
          showNotif("Solo el anfitrión puede cambiar el orden de turnos");
          return null;
        }
      } else if (online.myPlayerIndex !== game.cp) {
        if (FIX_ACTIONS.has(action.type)) {
          if (!online.room.isHost) {
            showNotif("Solo el anfitrión puede corregir fuera de su turno");
            return null;
          }
        } else if (TURN_ACTIONS.has(action.type)) {
          // Excepción: expansión 5-6, construir para uno mismo en turno ajeno.
          const specialBuild = game.expansion && BUILD_ACTIONS.has(action.type)
            && action.player === online.myPlayerIndex;
          if (!specialBuild) {
            showNotif(`⏳ Es el turno de ${game.players[game.cp]?.name || "otro jugador"}`);
            return null;
          }
        }
      }
    }
    const stamped = dispatchAction(action);
    if (action.type === "MOVE_PLAYER") followMyClaimRef.current?.(action);
    // Sin condicionar por online.room: apenas se crea la sala, la primera
    // acción se despacha en el mismo tick y `online.room` todavía es null en
    // este closure. pushAction ya no hace nada si no hay sala.
    online.pushAction(stamped);
    return stamped;
  }, [dispatchAction, online.room, online.pushAction, online.myPlayerIndex, game.started, game.cp, game.players, game.expansion, showNotif]);

  // Partida guardada pendiente de retomar (si existe y no terminó).
  // Si la guardada ya estaba terminada, se archiva en el historial antes de
  // descartarla: antes se perdía en silencio al recargar.
  const [savedGame, setSavedGame] = useState(() => {
    const saved = loadSavedGame();
    if (!saved) return null;
    const state = replayActions(saved.actions);
    if (!(state.started || state.inLobby)) return null;
    if (isGameFinished(state)) {
      archiveGame(saved.actions);
      clearSavedActions();
      return null;
    }
    return { actions: saved.actions, state, roomCode: loadSavedRoomCode() };
  });

  // ── HISTORIAL ──
  const [history, setHistory] = useState(() => loadHistory());
  const [openGameId, setOpenGameId] = useState(null); // partida del historial abierta
  // Borrado con dos toques (el resto de la app no usa confirm() nativo):
  // guarda el id a confirmar, o "all" para el historial entero.
  const [confirmDelete, setConfirmDelete] = useState(null);

  // ── DIAGNÓSTICO ──
  // Errores registrados en este dispositivo. La tarjeta solo aparece si hubo
  // alguno: cuando nada se rompió, no hay nada que mostrar.
  const [errors, setErrors] = useState(() => loadErrors());
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [errorsCopied, setErrorsCopied] = useState(false);

  // UI / setup state
  const [phase, setPhase] = useState("mode");
  const [gameMode, setGameMode] = useState("full");
  const [pCount, setPCount] = useState(3);
  const [expansion, setExpansion] = useState(false); // 5-6: fase de construcción especial
  const [buildSeat, setBuildSeat] = useState(null); // quién construye (mesa local con expansión)
  const [setupPlayers, setSetupPlayers] = useState([]);
  const [setupIdx, setSetupIdx] = useState(0);
  const [setupData, setSetupData] = useState({});
  const [tab, setTab] = useState("dados");
  const [rolling, setRolling] = useState(false);
  const [manualPickerOpen, setManualPickerOpen] = useState(() => loadPrefManual());
  const [modal, setModal] = useState(null);
  const [winner, setWinner] = useState(null);
  // Ganador ya avisado: "Seguir jugando" cierra el cartel para corregir el
  // puntaje sin que el efecto lo vuelva a abrir en el próximo render.
  const winnerAckRef = useRef(null);
  // Partida cuyo fin ya se contó como evento (una vez por partida).
  const trackedEndRef = useRef(null);
  // Modal-level state (lifted to avoid hooks-in-IIFE)
  // El código de sala se puede precargar por URL (?sala=CODIGO) para unirse con un tap.
  const [joinCode, setJoinCode] = useState(() => {
    try { return (new URLSearchParams(window.location.search).get("sala") || "").toUpperCase(); } catch { return ""; }
  });
  const [joinBusy, setJoinBusy] = useState(false);
  const [modalDiscards, setModalDiscards] = useState(eHand());
  const [modalHexes, setModalHexes] = useState([{ num: "", res: "" }]);
  const [tradeOther, setTradeOther] = useState(0);
  const [tradeGive, setTradeGive] = useState(eHand());
  const [tradeReceive, setTradeReceive] = useState(eHand());
  // Lobby: asiento en edición (null = el jugador reclamado) + editor local
  const [fixOpen, setFixOpen] = useState(null); // jugador con el panel de correcciones abierto
  const [rulesQ, setRulesQ] = useState("");
  const [rulesMsgs, setRulesMsgs] = useState([]);
  const [rulesBusy, setRulesBusy] = useState(false);
  const [lobbyBusy, setLobbyBusy] = useState(false);
  // El editor del lobby vive debajo de la lista: al abrirlo se lleva la vista
  // hasta él, porque si no queda fuera de pantalla y no se ve que se abrió.
  const seatEditorRef = useRef(null);
  const scrollToSeatEditor = useCallback(() => {
    requestAnimationFrame(() => {
      seatEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);
  const [editingSeat, setEditingSeat] = useState(null);
  const [seatLoaded, setSeatLoaded] = useState(null);
  const [seatName, setSeatName] = useState("");
  const [lobbySett, setLobbySett] = useState([{ hexes: [{ num: "", res: "" }] }, { hexes: [{ num: "", res: "" }] }]);

  const { players, cp, turnPhase, dice, deck, robber, turn, diceHistory, lastDistribution, log } = game;
  const mode = GAME_MODES[game.started ? game.gameMode : gameMode];

  // ── CONTROL POR TURNO (sala online) ──
  // Sin sala, o sin jugador reclamado (celular "mesa"): control total.
  const myIdx = online.myPlayerIndex;
  const inRoomAsPlayer = Boolean(online.room) && myIdx !== null;
  const isMyTurn = inRoomAsPlayer && myIdx === cp;
  const canAct = !inRoomAsPlayer || isMyTurn;
  const canFix = canAct || Boolean(online.room?.isHost);

  // Mi asiento sigue a mi jugador cuando se reordenan los turnos. Cada
  // dispositivo corrige solo su propia fila de room_members (es lo único que
  // le permite RLS), y entre todos el mapeo asiento→celular queda consistente.
  useEffect(() => {
    followMyClaimRef.current = (action) => {
      const mine = online.myPlayerIndex;
      if (mine === null) return;
      const other = action.idx + action.dir;
      if (mine !== action.idx && mine !== other) return;
      const target = mine === action.idx ? other : action.idx;
      // `players` es el estado previo al swap: el nombre es el de mi jugador.
      online.claimPlayer(target, players[mine]?.name || null);
    };
  }, [online.myPlayerIndex, online.claimPlayer, players]);

  // ── CONSTRUCCIÓN ──
  // Con la expansión 5-6 se puede construir en el turno de otro: en una sala
  // cada celular construye para su jugador; en modo mesa se elige el asiento.
  const buildIdx = inRoomAsPlayer ? myIdx : (game.expansion && buildSeat !== null ? buildSeat : cp);
  const buildingForOther = buildIdx !== cp;
  const canBuildNow = !buildingForOther || Boolean(game.expansion);
  const builder = players[buildIdx] || players[cp];

  // La pantalla no se apaga durante la partida (se libera al terminar).
  useWakeLock(phase === "game" && game.started && winner === null);

  // ── SCORES (derivados del estado del juego) ──
  const scores = useMemo(() => computeScores(players), [players]);
  const largestArmy = useMemo(() => computeLargestArmy(players, game.titles), [players, game.titles]);
  const longestRoad = useMemo(() => computeLongestRoad(players, game.titles), [players, game.titles]);

  const finalScores = useMemo(() => scores.map((s, i) => {
    let v = s;
    if (largestArmy === i) v += 2;
    if (longestRoad === i) v += 2;
    return v;
  }), [scores, largestArmy, longestRoad]);

  // Orden de la barra superior: por puntos (incluye cartas de victoria y títulos).
  // El sort es estable, así que a igual puntaje queda el orden de turnos.
  const scoreOrder = useMemo(
    () => players.map((_, i) => i).sort((a, b) => finalScores[b] - finalScores[a]),
    [players, finalScores],
  );

  // ── ESTADÍSTICAS EN VIVO ──
  // Se derivan del log de acciones (no de contadores en el estado), así que
  // acompañan deshacer y resync solos, y una partida retomada muestra el
  // historial completo hacia atrás. Se recalculan cuando cambia el log.
  const matchStats = useMemo(() => computeMatchStats(actions), [actions]);

  // ── CHECK WIN ──
  // Gana quien llega a 10 contando también sus cartas de punto sin revelar:
  // el jugador con 9 a la vista y una carta guardada gana sin haberla
  // mostrado. `findWinner` lo declara en su turno (los puntos suben ahí).
  const trueScores = useMemo(() => computeTrueScores(players, game.titles), [players, game.titles]);
  useEffect(() => {
    const w = findWinner(game);
    if (w >= 0 && winner === null && winnerAckRef.current !== w) setWinner(w);
    // Si el puntaje del avisado cae por debajo de la meta (corrección o undo),
    // vuelve a estar habilitado para avisar cuando la cruce de nuevo.
    if (winnerAckRef.current !== null && !(trueScores[winnerAckRef.current] >= WINNING_SCORE)) {
      winnerAckRef.current = null;
    }
  }, [game, trueScores, winner]);

  // ── PRIVACIDAD DE LA MANO ──
  // En una sala, cada celular ve solo sus recursos y sus cartas: de los demás
  // se ve lo que en la mesa real también se ve (cuántas cartas tienen), nunca
  // cuáles. Un celular sin jugador reclamado es "la mesa" y ve todo, porque es
  // el modo en que un solo teléfono lleva la partida de todos.
  const canSeeHandOf = useCallback((i) => !inRoomAsPlayer || i === myIdx, [inRoomAsPlayer, myIdx]);


  // ── ARCHIVAR AL TERMINAR ──
  // Cada vez que la partida está ganada se archiva. Es idempotente por id de
  // partida, así que corregir un puntaje después de ganada actualiza la entrada
  // en vez de duplicarla, y no reescribe el storage si el log no cambió.
  useEffect(() => {
    if (!game.started || actions.length === 0) return;
    if (!isGameFinished(game) || isArchived(actions)) return;
    setHistory(archiveGame(actions));
    // El archivado se repite si el puntaje se corrige después de ganada (el log
    // crece), pero el evento tiene que contar una partida, no cada corrección.
    const id = actions[0]?.uid;
    if (trackedEndRef.current === id) return;
    trackedEndRef.current = id;
    trackEvent("partida_terminada", {
      jugadores: game.players.length,
      ronda: game.turn,
      tiradas: game.rollCount || 0,
      modo: game.gameMode,
      expansion: !!game.expansion,
      online: Boolean(online.room),
    });
  }, [game, actions, online.room]);

  // ── SINCRONIZAR CON LA NUBE ──
  // El archivo local (arriba) es la fuente de verdad del dispositivo; esto
  // sube además el resumen a Supabase, si está configurado, para tener las
  // partidas en la base y verlas desde otro celular. Sin Supabase no hace nada.
  const saveCloudGame = cloud.saveGame;
  const seatOwners = useMemo(() => Object.fromEntries(
    online.members.filter(m => m.player_index != null).map(m => [m.player_index, m.user_id])
  ), [online.members]);
  useEffect(() => {
    if (actions.length === 0 || !(game.started || game.inLobby)) return;
    saveCloudGame(actions, { roomCode: online.room?.code || null, seatOwners, force: winner !== null });
  }, [actions, game.started, game.inLobby, winner, online.room, seatOwners, saveCloudGame]);


  // ── DESCARTE PROPIO (sala online) ──
  // El 7 lo tira uno solo, pero descarta cada uno en su celular: al detectar
  // la tirada, el dispositivo abre el descarte de su jugador si le corresponde
  // y todavía no lo hizo.
  useEffect(() => {
    if (!game.started || !inRoomAsPlayer || modal !== null) return;
    if (totalC(players[myIdx]?.hand || eHand()) <= 7) return;
    const eff = effectiveActions(actions);
    let lastRoll = -1;
    for (let i = eff.length - 1; i >= 0; i--) {
      if (eff[i].type === "ROLL") { lastRoll = i; break; }
    }
    if (lastRoll === -1) return;
    const r = eff[lastRoll];
    if (r.d1 + r.d2 !== 7) return;
    const yaDescarto = eff.slice(lastRoll).some(a => a.type === "DISCARD" && a.player === myIdx);
    if (yaDescarto) return;
    setModalDiscards(eHand());
    setModal({ type: "discard", queue: [myIdx], current: 0 });
  }, [game.started, inRoomAsPlayer, myIdx, players, actions, modal]);

  // ── AVISO DE TURNO ──
  // En sala online con jugador reclamado: vibración + notificación cuando
  // arranca tu turno (una sola vez por turno).
  const lastTurnNotifRef = useRef(null);
  useEffect(() => {
    if (!game.started || !isMyTurn || turnPhase !== "preroll") return;
    const key = `${turn}:${cp}`;
    if (lastTurnNotifRef.current === key) return;
    lastTurnNotifRef.current = key;
    vibrate([90, 70, 90]);
    showNotif(`🎲 ¡Es tu turno, ${players[cp]?.name}!`, 4000);
  }, [game.started, isMyTurn, turnPhase, turn, cp, players, showNotif]);

  // Al cambiar el turno, el selector de dados vuelve a la preferencia guardada
  // (quien usa dados físicos ve el teclado 2-12 directo).
  useEffect(() => {
    if (game.started) setManualPickerOpen(loadPrefManual());
    setBuildSeat(null); // la fase de construcción especial es por turno
  }, [game.started, cp, turn]);

  // ── TRANSICIÓN LOBBY ⇄ JUEGO ──
  // Cuando llega BEGIN_GAME (local o remoto) el lobby pasa a juego; si un
  // deshacer vuelve la partida al lobby, la pantalla acompaña.
  useEffect(() => {
    if (phase === "lobby" && game.started) {
      setPhase("game");
      setTab("dados");
      setEditingSeat(null);
    } else if (phase === "game" && !game.started && game.inLobby) {
      setPhase("lobby");
    }
  }, [phase, game.started, game.inLobby]);

  // Carga en el editor local los datos del asiento a editar (una sola vez por asiento).
  useEffect(() => {
    const seat = editingSeat ?? myIdx;
    if (!game.inLobby || seat === null || seat === seatLoaded) return;
    const p = players[seat];
    if (!p) return;
    setSeatName(p.name);
    const groups = {};
    p.productions.forEach(pr => { (groups[pr.gid] = groups[pr.gid] || []).push(pr); });
    const setts = Object.values(groups).map(hexes => ({ hexes: hexes.map(h => ({ num: String(h.num), res: h.res })) }));
    while (setts.length < 2) setts.push({ hexes: [{ num: "", res: "" }] });
    setLobbySett(setts.slice(0, 2));
    setSeatLoaded(seat);
  }, [editingSeat, myIdx, game.inLobby, players, seatLoaded]);

  // ── CONTINUAR PARTIDA ──
  const continueSavedGame = () => {
    if (!savedGame) return;
    replaceActions(savedGame.actions);
    setWinner(null);
    setTab("dados");
    setPhase(savedGame.state.started ? "game" : "lobby");
    // Si la partida guardada era online, intenta reconectar a la sala:
    // el servidor pisa el log local con el orden canónico + realtime.
    if (savedGame.roomCode && online.isConfigured) {
      online.joinRoom(savedGame.roomCode)
        .then(({ actions: remoteActions }) => {
          if (remoteActions.length > 0) replaceActions(remoteActions);
          showNotif("🌐 Reconectado a la sala");
        })
        .catch(() => showNotif("No se pudo reconectar a la sala (seguís en modo local)"));
    }
    setSavedGame(null);
  };

  const discardSavedGame = () => {
    clearSavedActions();
    setSavedGame(null);
  };

  // ── SETUP HANDLERS ──
  const initPlayers = () => {
    const list = [];
    for (let i = 0; i < pCount; i++) {
      list.push({ name: `Jugador ${i + 1}`, ci: i, _colorOpen: false });
    }
    setSetupPlayers(list);
    const sd = {};
    for (let i = 0; i < pCount; i++) sd[i] = [{ hexes: [{ num: "", res: "" }] }, { hexes: [{ num: "", res: "" }] }];
    setSetupData(sd);
    setPhase("names");
  };

  const moveSetupPlayer = (idx, dir) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= setupPlayers.length) return;
    setSetupPlayers(prev => {
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
    setSetupData(prev => {
      const np = { ...prev };
      [np[idx], np[newIdx]] = [np[newIdx], np[idx]];
      return np;
    });
  };

  const startGame = () => {
    dispatch({
      type: "START_GAME",
      mode: gameMode,
      expansion,
      players: setupPlayers.map(p => ({ name: p.name, ci: p.ci })),
      settlements: setupData,
      deck: shuffle([...INIT_DECK]),
    });
    setSavedGame(null);
    setWinner(null);
    setTab("dados");
    setPhase("game");
    trackEvent("partida_iniciada", {
      jugadores: setupPlayers.length,
      modo: gameMode,
      expansion,
      online: Boolean(online.room),
    });
  };

  const newGame = () => {
    online.leaveRoom();
    resetGame();
    setWinner(null);
    winnerAckRef.current = null;
    trackedEndRef.current = null;
    setSetupPlayers([]);
    setSetupData({});
    setModal(null);
    setTab("dados");
    setEditingSeat(null);
    setSeatLoaded(null);
    lastTurnNotifRef.current = null;
    setPhase("mode");
  };

  // ── GAME HANDLERS ──
  const processRoll = (d1, d2, manual = false) => {
    const sum = d1 + d2;
    dispatch({ type: "ROLL", d1, d2, manual });
    vibrate(sum === 7 ? [70, 60, 140] : 60);

    if (sum === 7) {
      // Un 7 no modifica manos hasta el descarte, así que `players` (pre-acción) sirve.
      // Cada uno descarta en su propio celular: acá solo entran las manos que
      // este dispositivo puede ver (la propia, o todas si es la mesa).
      const needDiscard = players
        .map((p, i) => ({ idx: i, total: totalC(p.hand) }))
        .filter(x => x.total > 7 && canSeeHandOf(x.idx));
      if (needDiscard.length > 0) {
        setModalDiscards(eHand());
        setModal({ type: "discard", queue: needDiscard.map(x => x.idx), current: 0 });
      } else {
        setModal({ type: "robber" });
      }
    } else {
      const gains = computeGains(players, sum, robber);
      const receiving = gains.filter(g => totalC(g) > 0).length;
      const blocked = robberNum(robber) === sum;
      if (receiving > 0) {
        showNotif(`📦 Recursos distribuidos (${receiving} jugador${receiving === 1 ? "" : "es"})${blocked ? ` · 🦹 bloquea el ${robberLabel(robber)}` : ""}`, 2500);
      } else if (blocked) {
        showNotif(`⛔ El ladrón bloquea el ${robberLabel(robber)}. Nadie recibe recursos.`);
      } else {
        showNotif(`Nadie produce con el ${sum}`);
      }
    }
  };

  const doRollDice = () => {
    savePrefManual(false);
    setRolling(true);
    const d1 = rollDie(), d2 = rollDie();
    setTimeout(() => {
      setRolling(false);
      processRoll(d1, d2);
    }, 600);
  };

  const doManualRoll = (sum) => {
    savePrefManual(true);
    // pick a random valid pair (d1, d2) in [1..6] that sums to `sum`, for display
    const min = Math.max(1, sum - 6);
    const max = Math.min(6, sum - 1);
    const d1 = min + Math.floor(Math.random() * (max - min + 1));
    const d2 = sum - d1;
    setManualPickerOpen(false);
    processRoll(d1, d2, true);
  };

  const applyDiscard = (playerIdx, discards) => {
    dispatch({ type: "DISCARD", player: playerIdx, discards });
  };

  // Jugadores que producen con ese número (y recurso, si se eligió).
  const playersOnHex = (num, res) => players
    .map((p, i) => (p.productions.some(pr => pr.num === num && (!res || pr.res === res)) ? i : -1))
    .filter(i => i >= 0);

  // Paso 2 → 3: si más de un jugador tiene ese número+recurso, puede haber dos
  // hexágonos distintos (el 8 de 1 y 2 vs. el 8 de 2 y 3) y hay que preguntar.
  const chooseRobberRes = (num, res) => {
    const onHex = playersOnHex(num, res);
    if (onHex.length <= 1) { placeRobber(num, res, onHex.length ? onHex : null); return; }
    setModal(m => ({ ...m, res, sel: onHex }));
  };

  const placeRobber = (num, res, sel) => {
    const onHex = sel && sel.length ? sel : null;
    dispatch({ type: "PLACE_ROBBER", num, res: res ?? null, players: onHex });
    // Víctimas: los lindantes al hexágono bloqueado (menos vos) con cartas.
    const victims = [];
    players.forEach((p, i) => {
      if (i === cp) return;
      if (onHex && !onHex.includes(i)) return;
      const touches = p.productions.some(pr => pr.num === num && (!res || pr.res === res));
      if (touches && totalC(p.hand) > 0) victims.push(i);
    });
    if (victims.length > 0) {
      setModal({ type: "steal", victims });
    } else {
      setModal(null);
      showNotif(`Ladrón en el ${res ? `${num} ${RM[res].e}` : num}. No hay a quién robar.`);
    }
  };

  const stealFrom = (victimIdx) => {
    const victim = players[victimIdx];
    const cards = [];
    Object.entries(victim.hand).forEach(([r, v]) => { for (let i = 0; i < v; i++) cards.push(r); });
    if (cards.length === 0) { setModal(null); return; }
    const stolen = cards[Math.floor(Math.random() * cards.length)];
    dispatch({ type: "STEAL", victim: victimIdx, res: stolen });
    showNotif(`Robaste ${RM[stolen].e} ${RM[stolen].n} a ${victim.name}`);
    setModal(null);
  };

  // Construir con confirmación + error claro
  const requestBuild = (type) => {
    if (!canBuildNow) {
      showNotif(`⏳ Es el turno de ${players[cp]?.name}`);
      return;
    }
    if (mode.enforceCosts) {
      // En la fase de construcción especial no hace falta haber tirado:
      // el dado es del jugador de turno, no de quien construye.
      if (!buildingForOther && turnPhase !== "rolled") {
        showNotif("Primero tirá los dados (y esperá a que se distribuyan recursos)");
        return;
      }
      const cost = COSTS[type];
      if (!afford(builder.hand, cost)) {
        showNotif("No se puede: te faltan recursos");
        return;
      }
    }
    setModal({ type: "confirmBuild", buildType: type });
  };

  const doBuild = (type) => {
    const cost = COSTS[type];
    if (mode.enforceCosts && !afford(builder.hand, cost)) { showNotif("No tenés suficientes recursos"); return; }

    if (type === "camino") {
      dispatch({ type: "BUILD_ROAD", player: buildIdx });
      showNotif("Camino construido");
    } else if (type === "poblado") {
      setModalHexes([{ num: "", res: "" }]);
      setModal({ type: "newSettlement", building: "poblado" });
    } else if (type === "ciudad") {
      setModal({ type: "upgradeCity" });
    } else if (type === "desarrollo") {
      // El mazo físico de la mesa manda: se elige qué carta salió.
      setModal({ type: "pickDev" });
    }
  };

  const buyDevCard = (card) => {
    dispatch({ type: "BUY_DEV", card, player: buildIdx });
    showNotif(card ? `Compraste: ${DC[card].e} ${DC[card].n}` : "Carta de desarrollo comprada");
    setModal(null);
  };

  const addSettlement = (hexes) => {
    dispatch({ type: "ADD_SETTLEMENT", hexes, player: buildIdx });
    showNotif("Poblado construido");
    setModal(null);
  };

  const upgradeToCity = (gidVal) => {
    dispatch({ type: "UPGRADE_CITY", gid: gidVal, player: buildIdx });
    showNotif("Ciudad construida");
    setModal(null);
  };

  const doTrade = (give, receive, ratio) => {
    dispatch({ type: "TRADE_BANK", give, receive, ratio });
    showNotif(`Cambiaste ${ratio} ${RM[give].n} por 1 ${RM[receive].n}`);
  };

  const doPlayerTrade = (otherIdx, give, receive) => {
    dispatch({ type: "TRADE_PLAYER", other: otherIdx, give, receive });
    showNotif("Comercio realizado");
  };

  const playDevCard = (cardType, cardIdx) => {
    if (players[cp].devCardBought.includes(cardType)) {
      showNotif(cardType === "victoria"
        ? "Esa carta la levantaste este turno: se revela a partir del próximo"
        : "No podés jugar una carta comprada este turno");
      return;
    }
    if (players[cp].devCardPlayed && cardType !== "victoria") {
      showNotif("Ya jugaste una carta este turno");
      return;
    }

    dispatch({ type: "PLAY_DEV", card: cardType, cardIdx });
    if (cardType === "caballero") {
      setModal({ type: "robber" });
    } else if (cardType === "monopolio") {
      setModal({ type: "monopoly" });
    } else if (cardType === "abundancia") {
      setModal({ type: "yearOfPlenty", picks: 0 });
    } else if (cardType === "caminos") {
      showNotif("Construcción: +2 caminos");
    } else if (cardType === "victoria") {
      showNotif("🏆 Punto de victoria revelado");
    }
    setModal(m => (m?.type === "playDev" ? null : m));
  };

  const applyMonopoly = (res) => {
    const stolen = players.reduce((acc, p, i) => i === cp ? acc : acc + p.hand[res], 0);
    dispatch({ type: "MONOPOLY", res });
    showNotif(`Monopolio: robaste ${stolen} ${RM[res].n}`);
    setModal(null);
  };

  const applyYearOfPlenty = (res) => {
    const last = (modal?.picks || 0) >= 1;
    dispatch({ type: "YEAR_OF_PLENTY", res, last });
    if (last) {
      showNotif("Abundancia: tomaste 2 recursos");
      setModal(null);
    } else {
      setModal(prev => ({ ...prev, picks: (prev?.picks || 0) + 1 }));
    }
  };

  const movePlayer = (idx, dir) => {
    dispatch({ type: "MOVE_PLAYER", idx, dir });
  };

  const endTurn = () => {
    dispatch({ type: "END_TURN" });
    setManualPickerOpen(loadPrefManual());
    setTab("dados");
  };

  const getTradeRatio = (res) => {
    const p = players[cp];
    if (p.ports.includes(res)) return 2;
    if (p.ports.includes("3:1")) return 3;
    return 4;
  };

  const addPort = (port) => {
    dispatch({ type: "ADD_PORT", port });
    showNotif(`Puerto ${port === "3:1" ? "3:1" : RM[port]?.n} agregado`);
  };

  const removePort = (port) => {
    dispatch({ type: "REMOVE_PORT", port });
  };

  const addFreeSettlement = (playerIdx, isCity = false) => {
    setModalHexes([{ num: "", res: "" }]);
    setModal({ type: "freeSettlement", playerIdx, isCity });
  };

  const addFreeProductions = (playerIdx, hexes, isCity) => {
    dispatch({ type: "ADD_FREE_SETTLEMENT", player: playerIdx, hexes, isCity });
    showNotif(isCity ? "Ciudad agregada" : "Poblado agregado");
    setModal(null);
  };

  const manualAdjust = (playerIdx, res, delta) => {
    dispatch({ type: "MANUAL_ADJUST", player: playerIdx, res, delta });
  };

  // ── CORRECCIONES (mesa física manda sobre el estado de la app) ──
  // Marcar un poblado ya cargado como ciudad, para cualquier jugador.
  const requestCityFree = (playerIdx) => {
    const groups = getSettlementGroups(players[playerIdx]).filter(g => !g.isCity);
    if (groups.length === 0) {
      // Sin poblados para mejorar: se carga la ciudad directamente con sus hexágonos.
      addFreeSettlement(playerIdx, true);
      return;
    }
    setModal({ type: "cityFree", playerIdx });
  };

  const upgradeCityFree = (playerIdx, gidVal) => {
    dispatch({ type: "UPGRADE_CITY_FREE", player: playerIdx, gid: gidVal });
    showNotif("🏙️ Ciudad marcada");
    setModal(null);
  };

  const adjustDev = (playerIdx, card, delta) => dispatch({ type: "ADJUST_DEV", player: playerIdx, card, delta });
  const adjustStat = (playerIdx, stat, delta) => dispatch({ type: "ADJUST_STAT", player: playerIdx, stat, delta });
  const assignTitle = (title, playerIdx) => dispatch({ type: "SET_TITLE", title, player: playerIdx });

  // ── ONLINE: crear / unirse / reconectar ──
  const createOnlineRoom = async () => {
    try {
      const r = await online.createRoom(actions);
      showNotif(`🌐 Sala creada: ${r.code}`);
    } catch (e) {
      showNotif(`No se pudo crear la sala: ${e.message}`);
    }
  };

  // ── LOBBY ONLINE ──
  // Crea la sala apenas se elige modo y cantidad: primero la sala vacía,
  // después CREATE_LOBBY (ya con sala, se publica solo).
  const createLobbyRoom = async () => {
    setLobbyBusy(true);
    try {
      // Primero se arma el lobby local (log limpio + CREATE_LOBBY) y después se
      // crea la sala subiendo ese log. Al revés, CREATE_LOBBY quedaba sin
      // publicar (el closure todavía no veía la sala) y el primer resync la
      // borraba del estado: pantalla en blanco.
      resetGame(); // descarta cualquier partida local previa
      const stamped = dispatchAction({ type: "CREATE_LOBBY", mode: gameMode, expansion, playerCount: pCount, deck: shuffle([...INIT_DECK]) });
      const r = await online.createRoom([stamped]);
      setSavedGame(null);
      setWinner(null);
      setEditingSeat(null);
      setSeatLoaded(null);
      setPhase("lobby");
      showNotif(`🌐 Sala creada: ${r.code}. Compartí el código.`);
    } catch (e) {
      // La sala no quedó creada: se vuelve al inicio en vez de dejar un lobby
      // local huérfano que no sincroniza con nadie.
      resetGame();
      setPhase("mode");
      showNotif(`No se pudo crear la sala: ${e.message}`);
    }
    setLobbyBusy(false);
  };

  const openSeatEditor = (i) => { setEditingSeat(i); scrollToSeatEditor(); };

  const saveSeatName = (seat) => {
    if (seat === null || !seatName.trim() || seatName.trim() === players[seat]?.name) return;
    dispatch({ type: "SET_PLAYER_NAME", player: seat, name: seatName.trim() });
  };

  const setSeatColor = (seat, ci) => {
    if (seat === null) return;
    dispatch({ type: "SET_PLAYER_NAME", player: seat, ci });
  };

  const saveSeatSettlements = (seat) => {
    if (seat === null) return;
    const cleaned = lobbySett
      .map(s => ({ hexes: s.hexes.filter(h => h.num && h.res) }))
      .filter(s => s.hexes.length > 0);
    if (cleaned.length === 0) { showNotif("Cargá al menos un hexágono (número + recurso)"); return; }
    saveSeatName(seat);
    dispatch({ type: "SET_INITIAL_SETTLEMENTS", player: seat, settlements: cleaned });
    showNotif("💾 Poblados guardados");
  };

  const updateLobbyHex = (si, hi, field, val) => setLobbySett(prev => {
    const np = prev.map(s => ({ hexes: s.hexes.map(h => ({ ...h })) }));
    np[si].hexes[hi][field] = val;
    return np;
  });
  const addLobbyHex = (si) => setLobbySett(prev => {
    const np = prev.map(s => ({ hexes: [...s.hexes] }));
    if (np[si].hexes.length < 3) np[si].hexes.push({ num: "", res: "" });
    return np;
  });
  const removeLobbyHex = (si, hi) => setLobbySett(prev => {
    const np = prev.map(s => ({ hexes: [...s.hexes] }));
    np[si].hexes = np[si].hexes.filter((_, j) => j !== hi);
    return np;
  });

  // ── CONSULTOR DE REGLAS ──
  // La pregunta va a /api/rules (la API key vive en el server, no en el cliente).
  const askRules = async (q) => {
    const question = (q ?? rulesQ).trim();
    if (!question || rulesBusy) return;
    const next = [...rulesMsgs, { role: "user", content: question }];
    setRulesQ("");
    setRulesMsgs(next);
    setRulesBusy(true);
    try {
      const r = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          history: rulesMsgs.slice(-6),
          context: { expansion: Boolean(game.expansion) },
        }),
      });
      const data = await r.json().catch(() => ({}));
      setRulesMsgs([...next, {
        role: "assistant",
        content: data.answer || data.error || "No pude responder. Probá de nuevo.",
        isError: !data.answer,
      }]);
    } catch {
      setRulesMsgs([...next, { role: "assistant", content: "Sin conexión: no pude consultar las reglas.", isError: true }]);
    }
    setRulesBusy(false);
  };

  // Comparte el código de sala con un link que lo precarga (?sala=CODIGO).
  const shareRoomCode = async () => {
    if (!online.room) return;
    const url = `${window.location.origin}${window.location.pathname}?sala=${online.room.code}`;
    const text = `🏝️ Unite a la partida de Catán con el código ${online.room.code}\n${url}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); showNotif("📋 Link copiado, pasáselo a tus amigos"); }
    } catch { /* usuario canceló el share */ }
  };

  const joinOnlineRoom = async (code) => {
    if (!code.trim()) return;
    setJoinBusy(true);
    try {
      const { actions: remoteActions } = await online.joinRoom(code);
      if (remoteActions.length === 0) throw new Error("La sala está vacía.");
      replaceActions(remoteActions);
      const st = replayActions(remoteActions);
      setSavedGame(null);
      setWinner(null);
      setTab("dados");
      setEditingSeat(null);
      setSeatLoaded(null);
      setPhase(st.started ? "game" : "lobby");
      showNotif(st.started ? "🌐 Conectado a la sala" : "🌐 Te uniste. ¡Elegí tu jugador!");
    } catch (e) {
      showNotif(e.message || "No se pudo conectar");
    }
    setJoinBusy(false);
  };

  // ── DESHACER ──
  // Recorta la última acción del log y replaya. Solo accesible sin modales
  // abiertos (el overlay bloquea el header), así no desincroniza flujos.
  const canUndo = effectiveActions(actions).length > 1; // START_GAME no se deshace
  const requestUndo = () => {
    if (!canUndo) return;
    setModal({ type: "undo" });
  };
  const doUndo = () => {
    // El deshacer es una acción más en el log (se sincroniza online).
    dispatch({ type: "UNDO" });
    setManualPickerOpen(loadPrefManual());
    setModal(null);
    showNotif("↩️ Última acción deshecha");
  };

  // ═══════════════════════════════════════════════
  //  RENDER: SETUP - MODE
  // ═══════════════════════════════════════════════
  if (phase === "mode") return (
    <div className="catan-app">
      <style>{STYLE_CSS}</style>
      <div className="catan-container center-screen">
        <div className="bg-slate-900/90 backdrop-blur rounded-3xl p-8 max-w-md w-full text-center shadow-2xl border border-amber-600/30">
          <div className="text-6xl mb-4">🏝️</div>
          <h1 className="text-4xl font-bold text-amber-400 mb-2">Catán</h1>
          <p className="text-slate-400 mb-6">Companion App</p>

          {savedGame && (
            <div className="mb-6 p-4 rounded-2xl border-2 border-emerald-500/60 bg-emerald-500/10 text-left">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl">💾</span>
                <span className="font-bold text-emerald-300">Partida en curso</span>
              </div>
              <p className="text-slate-300 text-sm mb-1">
                {savedGame.state.players.map(p => p.name).join(", ")}
              </p>
              <p className="text-slate-400 text-xs mb-3">
                {savedGame.state.started ? `Turno ${savedGame.state.turn}` : "Sala en preparación"} · Modo {savedGame.state.gameMode === "simple" ? "Simple" : "Completo"}
              </p>
              <div className="flex gap-2">
                <button onClick={continueSavedGame}
                  className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold rounded-xl transition-all">
                  ▶️ Continuar
                </button>
                <button onClick={discardSavedGame}
                  className="py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-semibold rounded-xl transition-all">
                  Descartar
                </button>
              </div>
            </div>
          )}

          {history.length > 0 && (
            <button onClick={() => { setOpenGameId(null); setPhase("historial"); cloud.refresh(); }}
              className="w-full mb-6 py-3 px-4 rounded-2xl border border-slate-700 bg-slate-800/60 hover:border-slate-600 text-left transition-all flex items-center gap-3">
              <span className="text-2xl">📚</span>
              <span className="flex-1">
                <span className="block font-bold text-slate-200">Partidas anteriores</span>
                <span className="block text-slate-400 text-sm">
                  {history.length} guardada{history.length === 1 ? "" : "s"} · con sus estadísticas completas
                </span>
              </span>
              <span className="text-muted">→</span>
            </button>
          )}

          {errors.length > 0 && (
            <div className="mb-6 p-4 rounded-2xl border border-red-500/40 bg-red-500/10 text-left">
              <button onClick={() => setErrorsOpen(o => !o)}
                className="w-full flex items-center gap-2 text-left">
                <span className="text-xl">⚠️</span>
                <span className="flex-1">
                  <span className="block font-bold text-red-300 text-sm">
                    {errors.length} error{errors.length === 1 ? "" : "es"} registrado{errors.length === 1 ? "" : "s"}
                  </span>
                  <span className="block text-slate-400 text-xs">
                    En este dispositivo. No afecta tus partidas.
                  </span>
                </span>
                <span className="text-muted text-xs">{errorsOpen ? "▲" : "▼"}</span>
              </button>
              {errorsOpen && (
                <>
                  <pre className="mt-3 max-h-40 overflow-auto bg-black/40 rounded-xl p-2 text-[10px] text-slate-400 whitespace-pre-wrap">
                    {formatErrorsForReport(errors)}
                  </pre>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => {
                        const text = formatErrorsForReport(errors);
                        if (navigator.clipboard?.writeText) {
                          navigator.clipboard.writeText(text)
                            .then(() => setErrorsCopied(true), () => setErrorsCopied(false));
                        }
                      }}
                      className="py-1.5 px-3 bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold rounded-lg transition-all">
                      {errorsCopied ? "✓ Copiado" : "Copiar para reportar"}
                    </button>
                    <button onClick={() => { clearErrors(); setErrors([]); setErrorsOpen(false); }}
                      className="py-1.5 px-3 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-semibold rounded-lg transition-all">
                      Limpiar
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <p className="text-slate-300 mb-5 text-lg">Elegí el modo de juego</p>
          <div className="space-y-3 mb-6">
            <button
              onClick={() => setGameMode("full")}
              className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${gameMode === "full" ? "border-amber-500 bg-amber-500/15" : "border-slate-700 bg-slate-800/60 hover:border-slate-600"}`}
            >
              <div className="flex items-center gap-3">
                <div className="text-3xl">🎯</div>
                <div className="flex-1">
                  <div className="font-bold text-amber-300 text-lg">Completo</div>
                  <div className="text-slate-400 text-sm">Conteo de cartas, costos de construcción, descarte en 7, cartas de desarrollo.</div>
                </div>
              </div>
            </button>
            <button
              onClick={() => setGameMode("simple")}
              className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${gameMode === "simple" ? "border-amber-500 bg-amber-500/15" : "border-slate-700 bg-slate-800/60 hover:border-slate-600"}`}
            >
              <div className="flex items-center gap-3">
                <div className="text-3xl">✍️</div>
                <div className="flex-1">
                  <div className="font-bold text-amber-300 text-lg">Simple</div>
                  <div className="text-slate-400 text-sm">Dado manual, distribución de cartas y construcciones libres para llevar el score.</div>
                </div>
              </div>
            </button>
          </div>
          <button onClick={() => setPhase("count")}
            className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-xl text-lg transition-all shadow-lg shadow-amber-500/20">
            Siguiente →
          </button>

          {online.isConfigured && (
            <div className="mt-6 pt-5 border-t border-slate-700/60">
              <p className="text-slate-400 text-sm mb-2">🌐 ¿Te invitaron a una partida?</p>
              <div className="flex gap-2">
                <input
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="CÓDIGO"
                  maxLength={6}
                  className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-center font-bold tracking-[.3em] uppercase focus:border-amber-500 focus:outline-none"
                />
                <button
                  onClick={() => joinOnlineRoom(joinCode)}
                  disabled={joinBusy || joinCode.trim().length < 4}
                  className="px-4 py-2.5 bg-blue-500 hover:bg-blue-400 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-xl transition-all">
                  {joinBusy ? "..." : "Unirse"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════
  //  RENDER: SETUP - PLAYER COUNT
  // ═══════════════════════════════════════════════
  // ═══════════════════════════════════════════════
  //  RENDER: HISTORIAL DE PARTIDAS
  //  El detalle usa el mismo StatsPanel que la partida en vivo: la historia de
  //  una partida es exactamente lo que se veía mientras se jugaba.
  // ═══════════════════════════════════════════════
  if (phase === "historial") {
    // Partidas que están en la nube pero no archivadas en este dispositivo
    // (las jugó otro celular de la sala).
    const cloudOnly = cloud.games.filter(g => !history.some(h => h.id === g.id));
    const open = openGameId ? history.find(g => g.id === openGameId) : null;

    if (open) {
      const stats = computeMatchStats(open.actions);
      const st = replayActions(open.actions);
      const scores = computeTrueScores(st.players, st.titles);
      const order = st.players.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
      const win = open.summary?.winner ?? order[0];
      return (
        <div className="catan-app">
          <style>{STYLE_CSS}</style>
          <div className="catan-container" style={{ padding: 16 }}>
            <div className="max-w-2xl mx-auto">
              <button onClick={() => setOpenGameId(null)}
                className="mb-4 py-2 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold rounded-xl transition-all">
                ← Historial
              </button>

              <div className="bg-slate-800 rounded-2xl p-5 text-center border border-amber-600/40 mb-4">
                <div className="text-4xl mb-2">{open.summary?.finished ? "🏆" : "⏹️"}</div>
                <h2 className="text-2xl font-bold text-amber-400">
                  {open.summary?.finished
                    ? `Ganó ${st.players[win]?.name || "—"}`
                    : "Partida sin terminar"}
                </h2>
                <p className="text-slate-300">{scores[win]} puntos de victoria</p>
                <p className="text-muted text-xs mt-1">
                  {fmtDate(open.finishedAt)} · Ronda {st.turn} · {stats.rollCount} tiradas ·
                  Modo {st.gameMode === "simple" ? "Simple" : "Completo"}
                  {st.expansion ? " · Expansión 5-6" : ""}
                </p>
              </div>

              <StatsPanel
                stats={stats}
                players={st.players}
                finalScores={scores}
                scoreOrder={order}
                longestRoad={computeLongestRoad(st.players, st.titles)}
                largestArmy={computeLargestArmy(st.players, st.titles)}
                diceHistory={st.diceHistory}
                winningScore={WINNING_SCORE}
                showDice
              />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="catan-app">
        <style>{STYLE_CSS}</style>
        <div className="catan-container" style={{ padding: 16 }}>
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => setPhase("mode")}
                className="py-2 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold rounded-xl transition-all">
                ← Inicio
              </button>
              <h1 className="text-xl font-bold text-amber-400">📚 Partidas anteriores</h1>
            </div>

            {cloud.isConfigured && (
              <div className="bg-slate-800 rounded-2xl p-4 mb-4">
                <label className="block text-xs font-bold text-slate-400 mb-1" htmlFor="perfil-nombre">
                  TU NOMBRE (para identificarte en las partidas)
                </label>
                <input id="perfil-nombre" value={cloud.profileName}
                  onChange={e => cloud.setProfileName(e.target.value)}
                  placeholder="Ej: Lucas"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white focus:border-amber-500 focus:outline-none" />
                <p className="text-muted text-xs mt-2">
                  Sin cuenta ni contraseña: este dispositivo queda identificado y sus partidas también se guardan en la nube.
                </p>
                {cloudOnly.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-700/60">
                    <p className="text-xs font-bold text-slate-400 mb-2">☁️ TAMBIÉN EN LA NUBE (jugadas en otro dispositivo)</p>
                    <div className="space-y-1.5">
                      {cloudOnly.map(g => (
                        <p key={g.id} className="text-xs text-slate-400">
                          {g.winnerName ? `🏆 ${g.winnerName}` : "⏳ Sin terminar"}
                          {" · "}{(g.players || []).map(p => p.name).join(", ") || `${g.playerCount} jugadores`}
                          {" · "}{g.rollCount || 0} tiradas
                          {g.roomCode ? ` · sala ${g.roomCode}` : ""}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {history.length === 0 ? (
              <p className="text-slate-400 text-sm bg-slate-800 rounded-2xl p-5">
                Todavía no hay partidas guardadas. Cuando termine una, aparece acá con sus estadísticas.
              </p>
            ) : (
              <>
                <div className="space-y-3">
                  {history.map(g => {
                    const sum = g.summary || {};
                    const ps = sum.players || [];
                    const win = sum.winner ?? 0;
                    return (
                      <div key={g.id} className="bg-slate-800 rounded-2xl p-4">
                        <button onClick={() => setOpenGameId(g.id)} className="w-full text-left">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                              <div className="font-bold text-slate-200">
                                {sum.finished ? `🏆 ${ps[win]?.name || "—"}` : "⏹️ Sin terminar"}
                                <span className="text-amber-300 ml-2">{sum.winnerScore ?? "—"} pts</span>
                              </div>
                              <div className="text-muted text-xs mt-0.5">
                                {fmtDate(g.finishedAt)} · Ronda {sum.round} · {sum.rollCount} tiradas
                                {sum.gameMode === "simple" ? " · Simple" : ""}
                                {sum.expansion ? " · Exp. 5-6" : ""}
                              </div>
                            </div>
                            <span className="text-muted text-sm shrink-0">Ver →</span>
                          </div>
                          {/* Jugadores con su color y su puntaje final */}
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {ps.map((p, i) => (
                              <span key={i} className="flex items-center gap-1.5 text-xs text-slate-400">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ background: COLORS[p.ci]?.h }} />
                                {p.name} <span className="text-slate-300 font-bold">{sum.scores?.[i] ?? 0}</span>
                              </span>
                            ))}
                          </div>
                        </button>
                        {confirmDelete === g.id ? (
                          <div className="mt-3 flex items-center gap-2">
                            <button onClick={() => { setHistory(deleteGame(g.id)); setConfirmDelete(null); }}
                              className="py-1.5 px-3 bg-red-600 hover:bg-red-600 text-white text-xs font-bold rounded-lg transition-all">
                              Sí, borrar
                            </button>
                            <button onClick={() => setConfirmDelete(null)}
                              className="py-1.5 px-3 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-semibold rounded-lg transition-all">
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDelete(g.id)}
                            className="mt-3 text-muted hover:text-red-400 text-xs transition-all">
                            🗑️ Borrar
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="bg-slate-800/70 rounded-2xl p-4 mt-3">
                  <p className="text-slate-400 text-xs">
                    Se guardan las últimas 20 partidas en este dispositivo. No se comparten entre celulares:
                    cada uno guarda las que jugó.
                  </p>
                {confirmDelete === "all" ? (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-slate-400 text-xs">¿Borrar las {history.length} partidas?</span>
                    <button onClick={() => { setHistory(clearHistory()); setConfirmDelete(null); }}
                      className="py-1.5 px-3 bg-red-600 hover:bg-red-600 text-white text-xs font-bold rounded-lg transition-all">
                      Sí, borrar todo
                    </button>
                    <button onClick={() => setConfirmDelete(null)}
                      className="py-1.5 px-3 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-semibold rounded-lg transition-all">
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDelete("all")}
                    className="mt-3 text-muted hover:text-red-400 text-xs transition-all">
                    Borrar todo el historial
                  </button>
                )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (phase === "count") return (
    <div className="catan-app">
      <style>{STYLE_CSS}</style>
      <div className="catan-container center-screen">
        <div className="bg-slate-900/90 backdrop-blur rounded-3xl p-8 max-w-md w-full text-center shadow-2xl border border-amber-600/30">
        <div className="text-6xl mb-4">🏝️</div>
        <h1 className="text-4xl font-bold text-amber-400 mb-2">Catán</h1>
        <p className="text-slate-400 mb-2">Companion App</p>
        <p className="text-amber-500/80 text-xs font-semibold uppercase tracking-wider mb-6">Modo {gameMode === "full" ? "Completo" : "Simple"}</p>
        <p className="text-slate-300 mb-4 text-lg">¿Cuántos jugadores?</p>
        <div className="flex gap-3 justify-center mb-8">
          {[2, 3, 4, 5, 6].map(n => (
            <button key={n} onClick={() => { setPCount(n); setExpansion(n >= 5); }}
              className={`w-14 h-14 rounded-xl text-xl font-bold transition-all ${pCount === n ? "bg-amber-500 text-slate-900 scale-110 shadow-lg shadow-amber-500/30" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>
              {n}
            </button>
          ))}
        </div>

        {pCount >= 5 && (
          <button onClick={() => setExpansion(v => !v)}
            className={`w-full mb-6 p-3 rounded-2xl border-2 text-left transition-all ${expansion ? "border-amber-500 bg-amber-500/15" : "border-slate-700 bg-slate-800/60"}`}>
            <div className="flex items-center gap-3">
              <div className={`w-5 h-5 rounded flex items-center justify-center text-xs font-black ${expansion ? "bg-amber-500 text-slate-900" : "bg-slate-700 text-muted"}`}>
                {expansion ? "✓" : ""}
              </div>
              <div className="flex-1">
                <div className="font-bold text-amber-300 text-sm">Expansión 5-6 jugadores</div>
                <div className="text-slate-400 text-xs">Habilita la fase de construcción especial: cada uno puede construir en el turno de otro.</div>
              </div>
            </div>
          </button>
        )}
        {online.isConfigured ? (
          <div className="space-y-3">
            <button onClick={createLobbyRoom} disabled={lobbyBusy}
              className="w-full py-3 bg-blue-500 hover:bg-blue-400 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-xl text-lg transition-all shadow-lg shadow-blue-500/20">
              {lobbyBusy ? "Creando sala..." : "🌐 Crear sala online"}
            </button>
            <p className="text-muted text-xs">
              Se genera un código para compartir. Cada jugador se une desde su celular,
              pone su nombre y carga sus poblados iniciales.
            </p>
            <button onClick={initPlayers}
              className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold rounded-xl transition-all">
              📱 Cargar todo en este celular
            </button>
          </div>
        ) : (
          <button onClick={initPlayers}
            className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-xl text-lg transition-all shadow-lg shadow-amber-500/20">
            Siguiente →
          </button>
        )}
        <button onClick={() => setPhase("mode")}
          className="w-full mt-3 py-2 text-slate-400 hover:text-slate-200 text-sm font-semibold transition-all">
          ← Cambiar modo
        </button>
      </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════
  //  RENDER: SETUP - NAMES
  // ═══════════════════════════════════════════════
  if (phase === "names") return (
    <div className="catan-app flex items-center justify-center p-4">
      <style>{STYLE_CSS}</style>
      <div className="bg-slate-900/90 backdrop-blur rounded-3xl p-8 max-w-md w-full shadow-2xl border border-amber-600/30" style={{position:"relative",zIndex:1}}>
        <h2 className="text-2xl font-bold text-amber-400 mb-2 text-center">Nombres y colores</h2>
        <p className="text-slate-400 text-xs text-center mb-5">El orden de la lista es el orden de turnos. Usá las flechas para reordenar.</p>
        <div className="space-y-3 mb-8">
          {setupPlayers.map((p, i) => {
            const usedColors = setupPlayers.map((pl, j) => j !== i ? pl.ci : -1).filter(c => c >= 0);
            const [open, setOpen] = [p._colorOpen || false, (v) => setSetupPlayers(prev => prev.map((pl, j) => j === i ? { ...pl, _colorOpen: v } : pl))];
            return (
              <div key={i} className="flex items-center gap-3">
                <div style={{position:"relative",flexShrink:0}}>
                  <button
                    onClick={() => setOpen(!open)}
                    style={{width:40,height:40,borderRadius:"50%",backgroundColor:COLORS[p.ci].h,border:"2px solid rgba(212,168,83,.5)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s"}}
                    title={COLORS[p.ci].n}
                  />
                  {open && (
                    <div style={{position:"absolute",top:46,left:"50%",transform:"translateX(-50)",zIndex:50,background:"#1e293b",border:"1px solid rgba(212,168,83,.4)",borderRadius:12,padding:8,display:"flex",gap:6,boxShadow:"0 8px 24px rgba(0,0,0,.6)"}}>
                      {COLORS.map((c, ci) => {
                        const used = usedColors.includes(ci);
                        return (
                          <button
                            key={ci}
                            disabled={used}
                            onClick={() => { setSetupPlayers(prev => prev.map((pl, j) => j === i ? { ...pl, ci, _colorOpen: false } : pl)); }}
                            style={{width:32,height:32,borderRadius:"50%",backgroundColor:c.h,border: ci === p.ci ? "2px solid #f0d48a" : "2px solid transparent",cursor: used ? "not-allowed" : "pointer",opacity: used ? 0.25 : 1,transition:"all .15s"}}
                            title={c.n + (ci >= 4 ? " (exp)" : "")}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
                <input
                  className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white focus:border-amber-500 focus:outline-none transition"
                  value={p.name}
                  onChange={e => {
                    const v = e.target.value;
                    setSetupPlayers(prev => prev.map((pl, j) => j === i ? { ...pl, name: v } : pl));
                  }}
                  placeholder={`Jugador ${i + 1}`}
                />
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => moveSetupPlayer(i, -1)}
                    disabled={i === 0}
                    className={`w-7 h-7 rounded-md flex items-center justify-center text-sm font-bold transition-all ${i === 0 ? "bg-slate-800 text-slate-600 cursor-not-allowed" : "bg-slate-700 text-amber-300 hover:bg-slate-600"}`}
                    title="Subir">
                    ▲
                  </button>
                  <button
                    onClick={() => moveSetupPlayer(i, 1)}
                    disabled={i === setupPlayers.length - 1}
                    className={`w-7 h-7 rounded-md flex items-center justify-center text-sm font-bold transition-all ${i === setupPlayers.length - 1 ? "bg-slate-800 text-slate-600 cursor-not-allowed" : "bg-slate-700 text-amber-300 hover:bg-slate-600"}`}
                    title="Bajar">
                    ▼
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button onClick={() => { setSetupIdx(0); setPhase("settlements"); }}
          className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-xl text-lg transition-all">
          Configurar poblados →
        </button>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════
  //  RENDER: SETUP - SETTLEMENTS
  // ═══════════════════════════════════════════════
  if (phase === "settlements") {
    const pData = setupData[setupIdx] || [];
    const updateHex = (settIdx, hexIdx, field, val) => {
      setSetupData(prev => {
        const np = { ...prev };
        np[setupIdx] = [...(np[setupIdx] || [])];
        np[setupIdx][settIdx] = { ...np[setupIdx][settIdx], hexes: [...np[setupIdx][settIdx].hexes] };
        np[setupIdx][settIdx].hexes[hexIdx] = { ...np[setupIdx][settIdx].hexes[hexIdx], [field]: val };
        return np;
      });
    };
    const addHex = (settIdx) => {
      setSetupData(prev => {
        const np = { ...prev };
        np[setupIdx] = [...(np[setupIdx] || [])];
        np[setupIdx][settIdx] = { ...np[setupIdx][settIdx], hexes: [...np[setupIdx][settIdx].hexes, { num: "", res: "" }] };
        return np;
      });
    };
    const removeHex = (settIdx, hexIdx) => {
      setSetupData(prev => {
        const np = { ...prev };
        np[setupIdx] = [...(np[setupIdx] || [])];
        np[setupIdx][settIdx] = { ...np[setupIdx][settIdx], hexes: np[setupIdx][settIdx].hexes.filter((_, j) => j !== hexIdx) };
        return np;
      });
    };

    return (
      <div className="catan-app p-4">
        <style>{STYLE_CSS}</style>
        <div className="max-w-lg mx-auto" style={{position:"relative",zIndex:1}}>
          <div className="bg-slate-900/90 backdrop-blur rounded-3xl p-6 shadow-2xl border border-amber-600/30">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style={{backgroundColor:COLORS[setupPlayers[setupIdx]?.ci ?? setupIdx].h}}>
                {setupIdx + 1}
              </div>
              <div>
                <h2 className="text-xl font-bold text-amber-400">{setupPlayers[setupIdx]?.name}</h2>
                <p className="text-slate-400 text-sm">Configurá los hexágonos de tus 2 poblados iniciales</p>
              </div>
            </div>

            {pData.map((sett, si) => (
              <div key={si} className="mb-6 bg-slate-800/50 rounded-2xl p-4">
                <h3 className="text-slate-300 font-semibold mb-3">🏠 Poblado {si + 1}</h3>
                <div className="space-y-2">
                  {sett.hexes.map((hex, hi) => (
                    <div key={hi} className="flex items-center gap-2">
                      <select value={hex.num} aria-label={`Número del hexágono ${hi + 1} del poblado ${si + 1}`}
                        onChange={e => updateHex(si, hi, "num", e.target.value)}
                        className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:border-amber-500 focus:outline-none">
                        <option value="">Nro</option>
                        {NUMS.map(n => <option key={n} value={n}>{n} {dotStr(n)}</option>)}
                      </select>
                      <select value={hex.res} aria-label={`Recurso del hexágono ${hi + 1} del poblado ${si + 1}`}
                        onChange={e => updateHex(si, hi, "res", e.target.value)}
                        className="flex-1 bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:border-amber-500 focus:outline-none">
                        <option value="">Recurso</option>
                        {RES.map(r => <option key={r.id} value={r.id}>{r.e} {r.n}</option>)}
                      </select>
                      {sett.hexes.length > 1 && (
                        <button onClick={() => removeHex(si, hi)} className="text-red-400 hover:text-red-300 px-2">✕</button>
                      )}
                    </div>
                  ))}
                </div>
                {sett.hexes.length < 3 && (
                  <button onClick={() => addHex(si)}
                    className="mt-2 text-sm text-amber-400 hover:text-amber-300">+ Agregar hexágono</button>
                )}
              </div>
            ))}

            <div className="flex gap-3">
              {setupIdx > 0 && (
                <button onClick={() => setSetupIdx(i => i - 1)}
                  className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl transition-all">
                  ← Anterior
                </button>
              )}
              {setupIdx < setupPlayers.length - 1 ? (
                <button onClick={() => setSetupIdx(i => i + 1)}
                  className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-xl transition-all">
                  Siguiente →
                </button>
              ) : (
                <button onClick={startGame}
                  className="flex-1 py-3 bg-green-500 hover:bg-green-400 text-slate-900 font-bold rounded-xl transition-all text-lg">
                  🎲 ¡Comenzar partida!
                </button>
              )}
            </div>

            <div className="flex gap-2 justify-center mt-4">
              {setupPlayers.map((_, i) => (
                <div key={i} className={`w-3 h-3 rounded-full transition-all ${i === setupIdx ? "scale-125" : ""}`} style={{backgroundColor: i === setupIdx ? COLORS[setupPlayers[i]?.ci ?? i].h : "#475569"}} />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════
  //  RENDER: LOBBY ONLINE
  //  El host creó la sala; cada jugador reclama su asiento, pone su nombre
  //  y carga sus poblados iniciales desde su celular.
  // ═══════════════════════════════════════════════
  if (phase === "lobby" && game.inLobby && players.length > 0) {
    const isHost = Boolean(online.room?.isHost);
    const canEditAny = isHost || myIdx === null;
    const seat = editingSeat ?? myIdx;
    const missing = players.filter(p => p.productions.length === 0);
    return (
      <div className="catan-app p-4">
        <style>{STYLE_CSS}</style>
        {notif && (
          <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",zIndex:40,background:"#1e293b",border:"1px solid rgba(212,168,83,.5)",color:"#f0e6d3",padding:"12px 24px",borderRadius:16,boxShadow:"0 8px 32px rgba(0,0,0,.5)",fontSize:15,fontWeight:700,maxWidth:400,textAlign:"center",fontFamily:"'Nunito',system-ui,sans-serif"}}>
            {notif}
          </div>
        )}
        <div className="max-w-lg mx-auto space-y-4" style={{position:"relative",zIndex:1}}>

          {/* Código de sala */}
          <div className="bg-slate-900/90 backdrop-blur rounded-3xl p-6 shadow-2xl border border-amber-600/30 text-center">
            <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">🌐 Sala — código para unirse</p>
            <p className="text-4xl font-black text-blue-300 tracking-[.3em] mb-1">{online.room?.code || "—"}</p>
            <p className={`text-xs font-semibold mb-3 ${online.connected ? "text-emerald-400" : "text-red-400"}`}>
              {online.connected ? "● Conectado" : "● Sin conexión"}
            </p>
            <button onClick={shareRoomCode}
              className="w-full py-2.5 bg-blue-500 hover:bg-blue-400 text-white font-bold rounded-xl transition-all">
              📤 Compartir código
            </button>
            <p className="text-muted text-xs mt-2">Modo {game.gameMode === "simple" ? "Simple" : "Completo"} · {players.length} jugadores</p>
          </div>

          {/* Asientos */}
          <div className="bg-slate-900/90 backdrop-blur rounded-3xl p-6 shadow-2xl border border-amber-600/30">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <h2 className="text-lg font-bold text-amber-400">Jugadores</h2>
              <span className={`text-xs font-bold ${missing.length === 0 ? "text-emerald-400" : "text-amber-300"}`}>
                {players.length - missing.length}/{players.length} con poblados
              </span>
            </div>
            <p className="text-slate-400 text-xs mb-4">
              Cada uno toca “¡Soy yo!” en su jugador, pone su nombre y carga sus 2 poblados iniciales.
              {canEditAny ? " El número es el orden de turnos: cambialo con ▲▼." : " El número es el orden de turnos."}
            </p>
            <div className="space-y-2">
              {players.map((p, i) => {
                const owner = online.members.find(m => m.player_index === i);
                const isMine = myIdx === i;
                const taken = owner && owner.user_id !== online.userId;
                return (
                  <div key={i} className={`flex items-center gap-3 p-2.5 rounded-xl ${isMine ? "bg-blue-500/15 ring-1 ring-blue-400" : "bg-slate-800/60"}`}>
                    <span className="text-muted text-xs font-bold w-3 text-right flex-shrink-0" aria-hidden="true">{i + 1}</span>
                    <span className="w-5 h-5 rounded-full flex-shrink-0" style={{backgroundColor: COLORS[p.ci].h}} />
                    <div className="flex-1 min-w-0">
                      <div className="text-white font-semibold text-sm truncate">
                        {p.name} {isMine && <span className="text-blue-300 text-xs">(vos)</span>}
                      </div>
                      <div className={`text-xs ${p.productions.length > 0 ? "text-emerald-400" : "text-muted"}`}>
                        {p.productions.length > 0 ? "✓ poblados listos" : "sin poblados"}{taken ? " · conectado" : ""}
                      </div>
                    </div>
                    {!taken && !isMine && (
                      <button onClick={() => { online.claimPlayer(i, p.name); setEditingSeat(null); scrollToSeatEditor(); }}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs font-bold rounded-lg transition-all">
                        ¡Soy yo!
                      </button>
                    )}
                    {isMine && (
                      <button onClick={() => online.claimPlayer(null, null)}
                        className="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-400 text-xs rounded-lg">
                        liberar
                      </button>
                    )}
                    {canEditAny && seat !== i && (
                      <button onClick={() => openSeatEditor(i)} title={`Editar a ${p.name}`}
                        aria-label={`Editar a ${p.name}`}
                        className="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg">
                        ✏️
                      </button>
                    )}
                    {canEditAny && players.length > 1 && (
                      <div className="flex flex-col gap-0.5">
                        <button onClick={() => dispatch({ type: "MOVE_PLAYER", idx: i, dir: -1 })}
                          disabled={i === 0} title={`Subir a ${p.name} en el orden de turnos`}
                          aria-label={`Subir a ${p.name} en el orden de turnos`}
                          className="px-2 leading-none text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300 disabled:opacity-25 disabled:cursor-not-allowed">
                          ▲
                        </button>
                        <button onClick={() => dispatch({ type: "MOVE_PLAYER", idx: i, dir: 1 })}
                          disabled={i === players.length - 1} title={`Bajar a ${p.name} en el orden de turnos`}
                          aria-label={`Bajar a ${p.name} en el orden de turnos`}
                          className="px-2 leading-none text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300 disabled:opacity-25 disabled:cursor-not-allowed">
                          ▼
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Editor del asiento (el propio, o cualquiera para host/mesa) */}
          {seat !== null && players[seat] ? (
            <div ref={seatEditorRef} style={{scrollMarginTop:16}}
              className="bg-slate-900/90 backdrop-blur rounded-3xl p-6 shadow-2xl border border-amber-600/30">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-lg font-bold text-amber-400">{seat === myIdx ? "Tu jugador" : `Editando a ${players[seat].name}`}</h2>
                {editingSeat !== null && editingSeat !== myIdx && (
                  <button onClick={() => setEditingSeat(null)}
                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-semibold rounded-lg transition-all">
                    ✕ Cerrar
                  </button>
                )}
              </div>
              <label className="text-slate-400 text-xs">Nombre</label>
              <input value={seatName} onChange={e => setSeatName(e.target.value)} onBlur={() => saveSeatName(seat)}
                placeholder="Nombre"
                className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-white focus:border-amber-500 focus:outline-none mt-1 mb-3" />
              <label className="text-slate-400 text-xs">Color</label>
              <div className="flex gap-2 mt-1 mb-4">
                {COLORS.map((c, ci) => {
                  const used = players.some((pl, j) => j !== seat && pl.ci === ci);
                  return (
                    <button key={ci} disabled={used} onClick={() => setSeatColor(seat, ci)} title={c.n}
                      style={{width:30,height:30,borderRadius:"50%",backgroundColor:c.h,border: players[seat].ci === ci ? "2px solid #f0d48a" : "2px solid transparent",opacity: used ? 0.25 : 1,cursor: used ? "not-allowed" : "pointer",transition:"all .15s"}} />
                  );
                })}
              </div>
              {[0, 1].map(si => (
                <div key={si} className="mb-4 bg-slate-800/50 rounded-2xl p-3">
                  <h3 className="text-slate-300 font-semibold text-sm mb-2">🏠 Poblado {si + 1} — hexágonos adyacentes</h3>
                  {(lobbySett[si]?.hexes || []).map((hex, hi) => (
                    <div key={hi} className="flex items-center gap-2 mb-2">
                      <select value={hex.num} aria-label={`Número del hexágono ${hi + 1} del poblado ${si + 1}`}
                        onChange={e => updateLobbyHex(si, hi, "num", e.target.value)}
                        className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:border-amber-500 focus:outline-none">
                        <option value="">Nro</option>
                        {NUMS.map(n => <option key={n} value={n}>{n} {dotStr(n)}</option>)}
                      </select>
                      <select value={hex.res} aria-label={`Recurso del hexágono ${hi + 1} del poblado ${si + 1}`}
                        onChange={e => updateLobbyHex(si, hi, "res", e.target.value)}
                        className="flex-1 bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:border-amber-500 focus:outline-none">
                        <option value="">Recurso</option>
                        {RES.map(r => <option key={r.id} value={r.id}>{r.e} {r.n}</option>)}
                      </select>
                      {(lobbySett[si]?.hexes.length || 0) > 1 && (
                        <button onClick={() => removeLobbyHex(si, hi)} className="text-red-400 hover:text-red-300 px-2">✕</button>
                      )}
                    </div>
                  ))}
                  {(lobbySett[si]?.hexes.length || 0) < 3 && (
                    <button onClick={() => addLobbyHex(si)} className="text-xs text-amber-400 hover:text-amber-300">+ Agregar hexágono</button>
                  )}
                </div>
              ))}
              <button onClick={() => saveSeatSettlements(seat)}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold rounded-xl transition-all">
                💾 Guardar poblados
              </button>
            </div>
          ) : (
            <div className="bg-slate-900/90 backdrop-blur rounded-3xl p-6 shadow-2xl border border-amber-600/30 text-center">
              <p className="text-slate-300 text-sm">👆 Tocá <b>“¡Soy yo!”</b> en tu jugador para poner tu nombre y cargar tus poblados.</p>
            </div>
          )}

          <button onClick={newGame} className="w-full py-2 text-muted hover:text-slate-300 text-sm font-semibold">
            ← Salir de la sala
          </button>

          {/* Espacio para que la barra fija no tape el final del contenido */}
          {(isHost || myIdx === null) && <div style={{height:96}} aria-hidden="true" />}
        </div>

        {/* Comenzar (host o mesa): fijo al pie, para que no haya que buscarlo
            abajo de la lista ni del editor. */}
        {(isHost || myIdx === null) && (
          <div style={{position:"fixed",left:0,right:0,bottom:0,zIndex:30,padding:"12px 16px",
            background:"linear-gradient(to top, rgba(15,23,42,.98) 60%, rgba(15,23,42,0))"}}>
            <div className="max-w-lg mx-auto">
              {missing.length > 0 && (
                <p className="text-amber-300/90 text-xs mb-2 text-center">
                  Faltan poblados de: {missing.map(p => p.name).join(", ")}
                </p>
              )}
              <button onClick={() => {
                  dispatch({ type: "BEGIN_GAME" });
                  trackEvent("partida_iniciada", {
                    jugadores: players.length, modo: game.gameMode,
                    expansion: !!game.expansion, online: true,
                  });
                }}
                className="w-full py-3.5 bg-green-500 hover:bg-green-400 text-slate-900 font-bold rounded-xl text-lg transition-all shadow-2xl">
                🎲 ¡Comenzar partida!
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════
  //  RENDER: GAME
  // ═══════════════════════════════════════════════
  // Red de seguridad: si la fase de UI y el estado del juego se desalinean
  // (p. ej. un resync deja el log vacío en un lobby), antes se devolvía null y
  // la pantalla quedaba en blanco sin forma de salir.
  if (phase !== "game" || !game.started) {
    if (phase === "mode" || phase === "count" || phase === "names" || phase === "settlements") return null;
    return (
      <div className="catan-container center-screen">
        <style>{STYLE_CSS}</style>
        <div className="catan-card p-6 text-center max-w-sm">
          <p className="text-4xl mb-3">🧭</p>
          <h2 className="text-xl font-black text-amber-100 mb-2">Se perdió el estado de la partida</h2>
          <p className="text-sm text-amber-200/80 mb-4">
            {online.room
              ? `La sala ${online.room.code} no devolvió acciones. Podés reintentar entrando con el código o volver al inicio.`
              : "No hay una partida en curso para mostrar."}
          </p>
          <button onClick={() => { online.leaveRoom(); resetGame(); setPhase("mode"); }}
            className="catan-btn w-full py-3 font-bold">Volver al inicio</button>
        </div>
      </div>
    );
  }
  const cur = players[cp];
  const diceSum = dice[0] + dice[1];

  const TABS = [
    { id: "dados", label: "Dados", e: "🎲" },
    { id: "construir", label: "Construir", e: "🏗️" },
    { id: "comerciar", label: "Comerciar", e: "🔄" },
    { id: "cartas", label: "Cartas", e: "🃏", hideInSimple: true },
    { id: "jugadores", label: "Jugadores", e: "👥" },
    { id: "stats", label: "Stats", e: "📊" },
    { id: "log", label: "Log", e: "📋" },
  ].filter(t => mode.showDevCards || !t.hideInSimple);

  return (
    <div className="catan-app flex flex-col">
      <style>{STYLE_CSS}</style>
      <div className="flex flex-col flex-1 min-h-screen" style={{position:"relative",zIndex:1}}>
      {/* Winner overlay */}
      {winner !== null && (
        <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto p-4">
          <div className="max-w-2xl mx-auto my-4">
            <div className="bg-slate-800 rounded-3xl p-6 text-center border-2 border-amber-500 mb-4">
              <div className="text-6xl mb-3">🏆</div>
              <h2 className="text-3xl font-bold text-amber-400 mb-1">¡{players[winner].name} gana!</h2>
              <p className="text-slate-300 text-lg">{trueScores[winner]} puntos de victoria</p>
              {/* Terminada la partida ya no hay secreto: se dice con qué ganó. */}
              {hiddenVP(players[winner]) > 0 && (
                <p className="text-amber-300/90 text-sm mt-1">
                  incluye {hiddenVP(players[winner])} carta{hiddenVP(players[winner]) === 1 ? "" : "s"} de punto que tenía guardada{hiddenVP(players[winner]) === 1 ? "" : "s"}
                </p>
              )}
              <p className="text-muted text-xs mt-2">Ronda {turn} · {matchStats.rollCount} tiradas</p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center mt-5">
                <button onClick={() => { winnerAckRef.current = winner; setWinner(null); }}
                  className="px-5 py-3 bg-slate-700 text-slate-200 font-bold rounded-xl">
                  Seguir jugando
                </button>
                <button onClick={newGame}
                  className="px-6 py-3 bg-amber-500 text-slate-900 font-bold rounded-xl">Nueva partida</button>
              </div>
              <p className="text-muted text-[11px] mt-3">
                &#34;Seguir jugando&#34; vuelve a la partida: útil si el puntaje necesita una corrección.
              </p>
            </div>

            {/* Las mismas estadísticas que estuvieron disponibles toda la partida */}
            <StatsPanel
              stats={matchStats}
              players={players}
              finalScores={finalScores}
              scoreOrder={scoreOrder}
              longestRoad={longestRoad}
              largestArmy={largestArmy}
              diceHistory={diceHistory}
              winningScore={WINNING_SCORE}
              showDice
            />
          </div>
        </div>
      )}

      {/* Notification */}
      {notif && (
        <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",zIndex:40,background:"#1e293b",border:"1px solid rgba(212,168,83,.5)",color:"#f0e6d3",padding:"12px 24px",borderRadius:16,boxShadow:"0 8px 32px rgba(0,0,0,.5)",fontSize:15,fontWeight:700,maxWidth:400,textAlign:"center",fontFamily:"'Nunito',system-ui,sans-serif"}}>
          {notif}
        </div>
      )}

      {/* Header */}
      <div className="bg-slate-800/90 border-b border-slate-700 px-4 py-3">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full" style={{backgroundColor:COLORS[cur.ci].h}} />
            <div>
              <span className="text-white font-bold">{cur.name}</span>
              <span className="text-slate-400 text-sm ml-2">Ronda {turn}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ml-2 uppercase tracking-wider ${game.gameMode === "simple" ? "bg-slate-700 text-slate-300" : "bg-amber-900/60 text-amber-300"}`}>
                {game.gameMode === "simple" ? "Simple" : "Completo"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {robberNum(robber) !== null && <span className="text-xs bg-red-900 text-red-300 px-2 py-1 rounded-full">🦹 {robberLabel(robber)}</span>}
            {online.isConfigured && (
              <button onClick={() => setModal({ type: "online" })}
                className="relative w-8 h-8 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded-lg text-base transition-all"
                title={online.room ? `Sala ${online.room.code}` : "Jugar online"}>
                🌐
                {online.room && (
                  <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-slate-800 ${online.connected ? "bg-emerald-400" : "bg-red-500"}`} />
                )}
              </button>
            )}
            <button onClick={() => setModal({ type: "rules" })}
              className="w-8 h-8 flex items-center justify-center bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-base transition-all"
              title="Consultar reglas">
              ❓
            </button>
            {canUndo && canFix && (
              <button onClick={requestUndo}
                className="w-8 h-8 flex items-center justify-center bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-base transition-all"
                title="Deshacer última acción">
                ↩️
              </button>
            )}
            {turnPhase === "rolled" && canAct && (
              <button onClick={endTurn}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-lg text-sm transition-all">
                Fin turno →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scores bar */}
      <div className="bg-slate-800/50 border-b border-slate-700/50 px-4 py-2 overflow-x-auto"
        tabIndex={0} role="region" aria-label="Puntajes de los jugadores">
        <div className="flex gap-4 max-w-2xl mx-auto px-2">
          {scoreOrder.map((i, pos) => {
            const p = players[i];
            return (
            <div key={i} className={`flex items-center gap-2 text-sm whitespace-nowrap ${i === cp ? "opacity-100" : "opacity-60"}`}>
              <div className="w-3 h-3 rounded-full" style={{backgroundColor:COLORS[p.ci].h}} />
              <span className="text-white font-medium">{pos === 0 && finalScores[i] > 0 ? "👑 " : ""}{p.name}</span>
              <span className="text-amber-400 font-bold">{finalScores[i]}VP</span>
              {largestArmy === i && <span title="Ejército más grande">⚔️</span>}
              {longestRoad === i && <span title="Camino más largo">🛤️</span>}
              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${totalC(p.hand) > 7 ? "bg-red-900/50 text-red-300" : "text-slate-400"}`} title={totalC(p.hand) > 7 ? "Más de 7 cartas: se descarta si sale 7" : "Cartas en mano"}>{totalC(p.hand)}🃏</span>
            </div>
            );
          })}
        </div>
      </div>

      {/* Tab bar */}
      <div className="bg-slate-800/30 border-b border-slate-700/50 overflow-x-auto">
        <div className="flex max-w-2xl mx-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 min-w-0 px-3 py-2.5 text-center text-xs font-medium transition-all whitespace-nowrap ${tab === t.id ? "text-amber-400 border-b-2 border-amber-400 bg-slate-800/50" : "text-slate-400 hover:text-slate-300"}`}>
              {t.e} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl mx-auto">

          {/* ── DADOS ── */}
          {tab === "dados" && (
            <div className="space-y-6">
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:16,width:"100%"}}>
                {!canAct && (
                  <div style={{width:"100%",maxWidth:480,margin:"0 auto",background:"rgba(44,24,16,.85)",border:"1px solid rgba(212,168,83,.25)",borderRadius:16,padding:"14px 18px",textAlign:"center"}}>
                    <div style={{fontFamily:"'Cinzel',serif",color:"#d4a853",fontSize:16,fontWeight:700,letterSpacing:1,marginBottom:4}}>
                      ⏳ Turno de {cur.name}
                    </div>
                    <div style={{color:"#a89278",fontSize:13,fontWeight:600,fontFamily:"'Nunito',system-ui,sans-serif"}}>
                      {turnPhase === "preroll" ? "Esperando la tirada de dados…" : "Está construyendo o comerciando…"} Tu celular se activa en tu turno.
                    </div>
                  </div>
                )}
                <div className="flex gap-4">
                  {dice[0] > 0 ? (
                    <>
                      <DiceFace value={dice[0]} rolling={rolling} />
                      <DiceFace value={dice[1]} rolling={rolling} />
                    </>
                  ) : (
                    <div className="flex gap-4">
                      <div className="w-16 h-16 bg-white rounded-xl shadow-lg flex items-center justify-center">
                        <span style={{fontSize:28,fontWeight:900,color:"#1e293b",fontFamily:"'Cinzel',serif"}}>?</span>
                      </div>
                      <div className="w-16 h-16 bg-white rounded-xl shadow-lg flex items-center justify-center">
                        <span style={{fontSize:28,fontWeight:900,color:"#1e293b",fontFamily:"'Cinzel',serif"}}>?</span>
                      </div>
                    </div>
                  )}
                </div>
                {diceSum > 0 && <div style={{fontSize:48,fontWeight:900,color:"#f0d48a",textShadow:"0 2px 18px rgba(212,168,83,.4)",fontFamily:"'Cinzel',serif",textAlign:"center"}}>{diceSum}</div>}
                {canAct && turnPhase === "preroll" && !mode.manualDiceOnly && !manualPickerOpen && (
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
                    <button onClick={doRollDice}
                      style={{background:"linear-gradient(135deg,#d4a853,#b8902e)",color:"#fff",fontFamily:"'Nunito',system-ui,sans-serif",fontWeight:800,fontSize:"1.15rem",padding:"16px 48px",borderRadius:12,border:"1px solid rgba(240,212,138,.55)",boxShadow:"0 14px 34px rgba(212,168,83,.35)",cursor:"pointer",textShadow:"0 1px 3px rgba(0,0,0,.4)",textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",gap:8,margin:"0 auto"}}>
                      🎲 Tirar dados
                    </button>
                    <button onClick={() => setManualPickerOpen(true)}
                      style={{background:"transparent",color:"#d4a853",fontFamily:"'Nunito',system-ui,sans-serif",fontWeight:700,fontSize:"0.92rem",padding:"6px 14px",borderRadius:10,border:"1px solid rgba(212,168,83,.35)",cursor:"pointer",textAlign:"center"}}>
                      ✍️ Ingresar manual
                    </button>
                  </div>
                )}
                {canAct && turnPhase === "preroll" && (mode.manualDiceOnly || manualPickerOpen) && (
                  <div style={{width:"100%",maxWidth:480,margin:"0 auto",background:"rgba(44,24,16,.85)",border:"1px solid rgba(212,168,83,.25)",borderRadius:16,padding:"16px 20px",backdropFilter:"blur(10px)"}}>
                    <div style={{fontFamily:"'Cinzel',serif",color:"#d4a853",fontSize:15,fontWeight:700,marginBottom:12,textAlign:"center",letterSpacing:1}}>✍️ Ingresar número de dados</div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(6, 1fr)",gap:8,marginBottom:12}}>
                      {Array.from({ length: 11 }, (_, k) => k + 2).map(n => (
                        <button key={n} onClick={() => doManualRoll(n)}
                          style={{padding:"12px 0",borderRadius:10,background:n===7?"linear-gradient(135deg,#b94a3c,#8a3528)":"linear-gradient(135deg,#d4a853,#b8902e)",color:"#fff",fontFamily:"'Cinzel',serif",fontWeight:800,fontSize:"1.1rem",border:"1px solid rgba(240,212,138,.4)",cursor:"pointer",boxShadow:"0 4px 12px rgba(0,0,0,.25)"}}>
                          {n}
                        </button>
                      ))}
                    </div>
                    {!mode.manualDiceOnly && (
                      <button onClick={() => setManualPickerOpen(false)}
                        style={{width:"100%",padding:"10px 14px",borderRadius:10,background:"rgba(100,116,139,.35)",border:"1px solid rgba(148,163,184,.4)",color:"#fff",fontFamily:"'Nunito',system-ui,sans-serif",fontWeight:700,fontSize:14,cursor:"pointer"}}>
                        Cancelar
                      </button>
                    )}
                  </div>
                )}
                {turnPhase === "rolled" && diceSum > 0 && diceSum !== 7 && (
                  <p style={{color:"#f0e6d3",fontWeight:700,fontSize:15,letterSpacing:".2px",textAlign:"center",margin:0}}>{(lastDistribution?.num === diceSum && lastDistribution?.lines?.length > 0) ? (canAct ? "Recursos distribuidos. Podés construir, comerciar o terminar turno." : "Recursos distribuidos.") : "Ningún jugador recibe recursos."}</p>
                )}
                {turnPhase === "rolled" && diceSum > 0 && diceSum !== 7 && lastDistribution?.num === diceSum && (
                  <div style={{width:"100%",maxWidth:480,margin:"0 auto",background:"rgba(44,24,16,.85)",border:"1px solid rgba(212,168,83,.25)",borderRadius:16,padding:"16px 20px",backdropFilter:"blur(10px)",textAlign:"center"}}>
                    <div style={{fontFamily:"'Cinzel',serif",color:"#d4a853",fontSize:15,fontWeight:700,marginBottom:10,textAlign:"center",letterSpacing:1}}>📦 Distribución</div>
                    {lastDistribution.lines.length > 0 ? (
                      <div style={{display:"flex",flexDirection:"column",gap:6}}>
                        {lastDistribution.lines.map((l, idx) => (
                          <div key={idx} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:10,background:"rgba(46,204,113,.12)",border:"1px solid rgba(46,204,113,.18)",borderLeft:"3px solid #2ecc71",color:"#f0e6d3",fontFamily:"'Nunito',system-ui,sans-serif",fontWeight:600,fontSize:14}}>
                            {playerMark(l.ci)} <span style={{fontWeight:800}}>{l.name}</span> <span style={{color:"#a89278",margin:"0 4px"}}>→</span> <span style={{fontWeight:800,color:"#2ecc71"}}>{l.items}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{color:"#a89278",fontSize:14,fontWeight:600,textAlign:"center"}}>Nadie recibe recursos</div>
                    )}
                  </div>
                )}

                {canAct && turnPhase === "rolled" && diceSum > 0 && (
                  <div style={{width:"100%",maxWidth:480,margin:"0 auto",display:"flex",flexDirection:"row",gap:12}}>
                    <button
                      style={{flex:1,padding:"14px 16px",borderRadius:12,background:"rgba(100,116,139,.35)",border:"2px solid rgba(148,163,184,.5)",color:"#fff",fontFamily:"'Nunito',system-ui,sans-serif",fontWeight:800,fontSize:16,cursor:"pointer",textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}
                      onClick={() => setTab("construir")}
                    >
                      🧱 Construir
                    </button>
                    <button
                      style={{flex:1,padding:"14px 16px",borderRadius:12,background:"rgba(100,116,139,.35)",border:"2px solid rgba(148,163,184,.5)",color:"#fff",fontFamily:"'Nunito',system-ui,sans-serif",fontWeight:800,fontSize:16,cursor:"pointer",textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}
                      onClick={() => setTab("comerciar")}
                    >
                      🤝 Comerciar
                    </button>
                  </div>
                )}

                {canAct && turnPhase === "rolled" && (
                  <button onClick={endTurn}
                    style={{width:"100%",maxWidth:480,margin:"0 auto",padding:"16px",borderRadius:12,background:"linear-gradient(135deg,#22c55e,#15803d)",border:"1px solid rgba(134,239,172,.55)",color:"#fff",fontFamily:"'Nunito',system-ui,sans-serif",fontWeight:800,fontSize:17,cursor:"pointer",boxShadow:"0 10px 26px rgba(34,197,94,.28)",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                    ✅ Terminar {isMyTurn ? "mi turno" : "turno"}
                  </button>
                )}

              </div>

              {/* Tiradas: mismo componente que el tab de estadísticas, en vivo */}
              <DiceStats dice={matchStats.dice} round={turn} history={diceHistory} />

              {/* Current player hand (o la mano reclamada en una sala online) */}
              {(() => {
                const handOwner = inRoomAsPlayer && players[myIdx] ? players[myIdx] : cur;
                return (
                  <div className={`bg-slate-800 rounded-2xl p-4 ${isMyTurn ? "ring-2 ring-amber-400" : ""}`}>
                    <h3 className="text-slate-300 font-semibold mb-3">
                      {inRoomAsPlayer ? `Tu mano — ${handOwner.name}` : "Tu mano"} ({totalC(handOwner.hand)} cartas)
                      {isMyTurn && <span className="ml-2 text-amber-400 text-xs font-bold">¡TU TURNO!</span>}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {RES.map(r => (
                        <div key={r.id} className={`${r.bg} ${r.tx} px-3 py-2 rounded-xl flex items-center gap-2 font-bold`}>
                          <span>{r.e}</span>
                          <span className="text-lg">{handOwner.hand[r.id]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── CARTAS DE DESARROLLO ──
                  Acá, junto a la mano, para no tener que buscarlas en otra
                  pestaña. Son secretas: cada celular ve las suyas. */}
              {(() => {
                const owner = inRoomAsPlayer && players[myIdx] ? players[myIdx] : cur;
                const ownerIdx = inRoomAsPlayer && players[myIdx] ? myIdx : cp;
                const myTurn = ownerIdx === cp && canAct;
                const guardados = hiddenVP(owner);
                // Aviso privado: solo en el celular de su dueño, para que la
                // mesa no se entere de que tiene la carta que define la partida.
                const puedeGanar = guardados > 0 && trueScores[ownerIdx] >= WINNING_SCORE;
                return (
                  <div className="bg-slate-800 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-slate-300 font-semibold">
                        🃏 Tus cartas de desarrollo ({owner.devCards.length})
                      </h3>
                      {owner.vpRevealed > 0 && (
                        <span className="text-xs text-amber-300 font-bold">🏆 {owner.vpRevealed} revelado{owner.vpRevealed === 1 ? "" : "s"}</span>
                      )}
                    </div>
                    {puedeGanar && (
                      <p className="text-emerald-300 text-xs bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-2.5 mb-3">
                        🏆 Con {guardados === 1 ? "tu carta de punto" : `tus ${guardados} cartas de punto`} llegás a {trueScores[ownerIdx]}: revelá para ganar.
                        Solo lo ves vos.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => doBuild("desarrollo")} disabled={!canAct}
                        className="py-3 bg-purple-500/90 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-xl transition-all">
                        🃏 Comprar carta
                      </button>
                      <button onClick={() => setModal({ type: "playDev" })}
                        disabled={!myTurn || owner.devCards.length === 0}
                        className="py-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-100 font-bold rounded-xl transition-all">
                        ▶️ Jugar carta
                      </button>
                    </div>
                    <p className="text-muted text-[11px] mt-2">
                      Las cartas y los recursos de cada uno son privados: en una sala, los demás solo ven cuántas tenés.
                    </p>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── CONSTRUIR ── */}
          {tab === "construir" && (
            <div className="space-y-4">
              <h3 className="text-slate-300 font-semibold">Construcciones</h3>

              {/* Mesa local con expansión: elegir quién construye */}
              {game.expansion && !inRoomAsPlayer && (
                <div className="bg-slate-800/60 rounded-2xl p-3">
                  <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">Construye</div>
                  <div className="flex flex-wrap gap-2">
                    {players.map((p, i) => (
                      <button key={i} onClick={() => setBuildSeat(i === cp ? null : i)}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-all"
                        style={{ backgroundColor: i === buildIdx ? COLORS[p.ci].h : "#334155" }}>
                        {p.name}{i === cp ? " (turno)" : ""}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!canBuildNow && (
                <p className="text-slate-400 text-sm">⏳ Es el turno de <span className="font-bold text-amber-300">{cur.name}</span>. Solo quien tiene el turno construye.</p>
              )}
              {canBuildNow && buildingForOther && (
                <p className="text-amber-300/90 text-sm bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
                  🏗️ <b>Fase de construcción especial</b> (expansión 5-6): construyendo para <b>{builder.name}</b> en el turno de {cur.name}.
                </p>
              )}
              {Object.entries(COSTS)
                .filter(([type]) => mode.showDevCards || type !== "desarrollo")
                .map(([type, cost]) => {
                const canBuild = canBuildNow && (mode.enforceCosts
                  ? (afford(builder.hand, cost) && (buildingForOther || turnPhase === "rolled"))
                  : true);
                return (
                  <div key={type} className="bg-slate-800 rounded-2xl p-4 flex items-center justify-between">
                    <div>
                      <div className="text-white font-bold">{COST_EMOJI[type]} {COST_NAMES[type]}</div>
                      {mode.enforceCosts && (
                        <div className="flex gap-1 mt-1">
                          {Object.entries(cost).map(([r, v]) => (
                            <ResBadge key={r} id={r} count={v} small />
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={() => requestBuild(type)} disabled={!canBuild}
                      className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${canBuild ? "bg-green-500 hover:bg-green-400 text-slate-900" : "bg-slate-700 text-muted cursor-not-allowed"}`}>
                      Construir
                    </button>
                  </div>
                );
              })}

              <div className="bg-slate-800/50 rounded-2xl p-4 mt-6">
                <h3 className="text-slate-300 font-semibold mb-3">{buildIdx === cp && !inRoomAsPlayer ? "Tus propiedades" : `Propiedades de ${builder.name}`}</h3>
                {getSettlementGroups(builder).length === 0 ? (
                  <p className="text-muted text-sm">Sin propiedades registradas</p>
                ) : (
                  <div className="space-y-2">
                    {getSettlementGroups(builder).map((g, i) => (
                      <div key={g.gid} className="flex items-center gap-2 flex-wrap">
                        <span className="text-white text-sm">{g.isCity ? "🏙️" : "🏠"}</span>
                        {g.hexes.map(h => (
                          <span key={h.id} className={`${RM[h.res].bg} ${RM[h.res].tx} px-2 py-0.5 rounded text-xs font-medium`}>
                            {h.num} {RM[h.res].e}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── COMERCIAR ── */}
          {tab === "comerciar" && (
            <div className="space-y-6">
              {!canAct && (
                <p className="text-slate-400 text-sm">⏳ Es el turno de <span className="font-bold text-amber-300">{cur.name}</span>. Solo quien tiene el turno comercia.</p>
              )}
              {/* Bank trade */}
              <div className="bg-slate-800 rounded-2xl p-4">
                <h3 className="text-slate-300 font-semibold mb-3">Comercio con el banco</h3>
                <div className="space-y-2">
                  {RES.map(give => {
                    const ratio = getTradeRatio(give.id);
                    if (cur.hand[give.id] < ratio) return null;
                    return (
                      <div key={give.id} className="bg-slate-700/50 rounded-xl p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <ResBadge id={give.id} count={ratio} small />
                          <span className="text-slate-200">→</span>
                          <span className="text-slate-300 text-sm">1 de:</span>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {RES.filter(r => r.id !== give.id).map(rec => (
                            <button key={rec.id} onClick={() => doTrade(give.id, rec.id, ratio)}
                              disabled={turnPhase !== "rolled" || !canAct}
                              className={`${rec.bg} ${rec.tx} px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:opacity-80 active:scale-95 disabled:opacity-40`}>
                              {rec.e} {rec.n}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {RES.every(r => cur.hand[r.id] < getTradeRatio(r.id)) && (
                    <p className="text-muted text-sm">No tenés suficientes recursos para comerciar con el banco.</p>
                  )}
                </div>
              </div>

              {/* Player trade */}
              <div className="bg-slate-800 rounded-2xl p-4">
                <h3 className="text-slate-300 font-semibold mb-3">Comercio entre jugadores</h3>
                <button onClick={() => { setTradeOther(cp === 0 ? 1 : 0); setTradeGive(eHand()); setTradeReceive(eHand()); setModal({ type: "playerTrade" }); }} disabled={turnPhase !== "rolled" || !canAct}
                  className={`w-full py-3 rounded-xl font-bold transition-all ${turnPhase === "rolled" && canAct ? "bg-blue-500 hover:bg-blue-400 text-white" : "bg-slate-700 text-muted cursor-not-allowed"}`}>
                  🤝 Proponer intercambio
                </button>
              </div>

              {/* Ports config */}
              <div className="bg-slate-800 rounded-2xl p-4">
                <h3 className="text-slate-300 font-semibold mb-3">Puertos de {cur.name}</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  {cur.ports.map(port => (
                    <span key={port} className="bg-blue-800 text-blue-200 px-2 py-1 rounded-lg text-sm flex items-center gap-1">
                      {port === "3:1" ? "⚓ 3:1" : `${RM[port].e} 2:1`}
                      {canAct && <button onClick={() => removePort(port)} className="text-blue-400 hover:text-white ml-1">✕</button>}
                    </span>
                  ))}
                  {cur.ports.length === 0 && <span className="text-muted text-sm">Sin puertos</span>}
                </div>
                {canAct && (
                  <div className="flex flex-wrap gap-2">
                    {!cur.ports.includes("3:1") && (
                      <button onClick={() => addPort("3:1")} className="bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg text-sm">+ ⚓ 3:1</button>
                    )}
                    {RES.filter(r => !cur.ports.includes(r.id)).map(r => (
                      <button key={r.id} onClick={() => addPort(r.id)} className="bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg text-sm">+ {r.e} 2:1</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── CARTAS DE DESARROLLO ── */}
          {/* En sala online se muestran las cartas del jugador reclamado (son
              secretas); se juegan solo en el turno propio. */}
          {tab === "cartas" && (() => {
            const cardOwner = inRoomAsPlayer && players[myIdx] ? players[myIdx] : cur;
            // Regla oficial: una carta se puede jugar en cualquier momento del
            // turno propio, también ANTES de tirar (caballero para mover el ladrón).
            const canPlayNow = canAct && cardOwner === cur;
            return (
              <div className="space-y-4">
                <div className="bg-slate-800 rounded-2xl p-4">
                  <h3 className="text-slate-300 font-semibold mb-2">
                    {inRoomAsPlayer ? `Tus cartas — ${cardOwner.name}` : "Tus cartas"} ({cardOwner.devCards.length})
                  </h3>
                  {cardOwner.devCards.length === 0 ? (
                    <p className="text-muted text-sm">No tenés cartas de desarrollo</p>
                  ) : (
                    <div className="space-y-2">
                      {cardOwner.devCards.map((c, i) => (
                        <div key={i} className="bg-slate-700/50 rounded-xl p-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{DC[c].e}</span>
                            <div>
                              <div className="text-white text-sm font-medium">{DC[c].n}</div>
                              <div className="text-slate-400 text-xs">{DC[c].d}</div>
                            </div>
                          </div>
                          {c !== "victoria" && canPlayNow && (
                            <button onClick={() => playDevCard(c, i)}
                              className="px-3 py-1.5 bg-purple-500 hover:bg-purple-400 text-white rounded-lg text-sm font-medium">
                              Jugar
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {inRoomAsPlayer && !isMyTurn && cardOwner.devCards.some(c => c !== "victoria") && (
                    <p className="text-muted text-xs mt-2">⏳ Las cartas se juegan en tu turno (antes o después de tirar).</p>
                  )}
                </div>
                <p className="text-muted text-sm text-center">Quedan {deck.length} cartas en el mazo</p>
              </div>
            );
          })()}

          {/* ── JUGADORES ── */}
          {tab === "jugadores" && (
            <div className="space-y-4">
              {players.map((p, i) => (
                <div key={i} className={`bg-slate-800 rounded-2xl p-4 ${i === cp ? "ring-2 " + COLORS[p.ci].ring : ""}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full" style={{backgroundColor:COLORS[p.ci].h}} />
                      <span className="text-white font-bold">{p.name}</span>
                      <span className="text-amber-400 font-bold text-sm">{finalScores[i]} VP</span>
                      {largestArmy === i && <span className="text-xs bg-purple-900 text-purple-300 px-2 py-0.5 rounded-full">⚔️ Ejército</span>}
                      {longestRoad === i && <span className="text-xs bg-amber-900 text-amber-300 px-2 py-0.5 rounded-full">🛤️ Camino</span>}
                    </div>
                    {canFix && (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => addFreeSettlement(i)}
                          className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded-lg"
                          title="Agregar poblado">
                          + 🏠
                        </button>
                        <button onClick={() => requestCityFree(i)}
                          className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded-lg"
                          title="Marcar/agregar ciudad">
                          + 🏙️
                        </button>
                        <button
                          onClick={() => movePlayer(i, -1)}
                          disabled={i === 0}
                          className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold ${i === 0 ? "bg-slate-800 text-slate-600 cursor-not-allowed" : "bg-slate-700 text-amber-300 hover:bg-slate-600"}`}
                          title="Subir en el orden de turnos">
                          ▲
                        </button>
                        <button
                          onClick={() => movePlayer(i, 1)}
                          disabled={i === players.length - 1}
                          className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold ${i === players.length - 1 ? "bg-slate-800 text-slate-600 cursor-not-allowed" : "bg-slate-700 text-amber-300 hover:bg-slate-600"}`}
                          title="Bajar en el orden de turnos">
                          ▼
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Recursos: los propios en detalle; los ajenos, solo cuántos
                      son (que es lo que también se ve en la mesa real). */}
                  {canSeeHandOf(i) ? (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {RES.map(r => (
                        <div key={r.id} className="flex items-center gap-1">
                          {canFix && (
                            <button onClick={() => manualAdjust(i, r.id, -1)}
                              aria-label={`Quitar ${r.n} a ${p.name}`}
                              className="w-5 h-5 bg-slate-700 hover:bg-red-700 text-slate-400 hover:text-white rounded text-xs flex items-center justify-center">−</button>
                          )}
                          <div className={`${r.bg} ${r.tx} px-2 py-0.5 rounded text-xs font-bold min-w-8 text-center`}>
                            {r.e}{p.hand[r.id]}
                          </div>
                          {canFix && (
                            <button onClick={() => manualAdjust(i, r.id, 1)}
                              aria-label={`Dar ${r.n} a ${p.name}`}
                              className="w-5 h-5 bg-slate-700 hover:bg-green-700 text-slate-400 hover:text-white rounded text-xs flex items-center justify-center">+</button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mb-3">
                      <span className="bg-slate-700/60 text-slate-300 px-2.5 py-1 rounded-lg text-xs font-bold">
                        🂠 {totalC(p.hand)} carta{totalC(p.hand) === 1 ? "" : "s"} en mano
                      </span>
                      <span className="text-muted text-[11px]">sus recursos son secretos</span>
                    </div>
                  )}

                  {/* Productions */}
                  <div className="flex flex-wrap gap-1">
                    {getSettlementGroups(p).map(g => (
                      <div key={g.gid} className="flex items-center gap-0.5 bg-slate-700/50 rounded-lg px-2 py-1">
                        <span className="text-xs">{g.isCity ? "🏙️" : "🏠"}</span>
                        {g.hexes.map(h => (
                          <span key={h.id} className={`${RM[h.res].bg} ${RM[h.res].tx} px-1 py-0 rounded text-xs`}>
                            {h.num}{RM[h.res].e}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>

                  {/* Extra info */}
                  <div className="flex gap-3 mt-2 text-xs text-slate-400 items-center">
                    <span>⚔️ {p.knightsPlayed}</span>
                    <span>🛤️ {p.roadsBuilt}</span>
                    <span>🃏 {p.devCards.length}</span>
                    {p.ports.length > 0 && <span>⚓ {p.ports.map(pt => pt === "3:1" ? "3:1" : RM[pt]?.e).join(" ")}</span>}
                    {canFix && (
                      <button onClick={() => setFixOpen(fixOpen === i ? null : i)}
                        className="ml-auto text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded-lg">
                        {fixOpen === i ? "Cerrar" : "✏️ Corregir puntos"}
                      </button>
                    )}
                  </div>

                  {/* Correcciones: cartas de desarrollo, caballeros/caminos y títulos.
                      Lo que vale es la mesa física; acá se lleva la app a ese estado. */}
                  {canFix && fixOpen === i && (
                    <div className="mt-3 pt-3 border-t border-slate-700 space-y-3">
                      {mode.showDevCards && !canSeeHandOf(i) && (
                        <p className="text-muted text-xs">
                          Las cartas de {p.name} son suyas: se corrigen desde su celular.
                        </p>
                      )}
                      {mode.showDevCards && canSeeHandOf(i) && (
                        <div>
                          <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1.5">Cartas de desarrollo</div>
                          <div className="space-y-1">
                            {Object.entries(DC).map(([key, c]) => {
                              const n = p.devCards.filter(d => d === key).length;
                              return (
                                <div key={key} className="flex items-center gap-2">
                                  <span className="text-base w-5 text-center">{c.e}</span>
                                  <span className="text-slate-300 text-xs flex-1 truncate">{c.n}</span>
                                  <button onClick={() => adjustDev(i, key, -1)} disabled={n === 0}
                                    className="w-6 h-6 bg-slate-700 hover:bg-red-700 disabled:opacity-30 text-slate-300 rounded text-xs">−</button>
                                  <span className="text-white text-xs font-bold w-4 text-center">{n}</span>
                                  <button onClick={() => adjustDev(i, key, 1)}
                                    className="w-6 h-6 bg-slate-700 hover:bg-green-700 text-slate-300 rounded text-xs">+</button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-4">
                        {[["knightsPlayed", "⚔️ Caballeros"], ["roadsBuilt", "🛤️ Caminos"]].map(([stat, label]) => (
                          <div key={stat} className="flex items-center gap-1.5">
                            <span className="text-slate-400 text-xs">{label}</span>
                            <button onClick={() => adjustStat(i, stat, -1)}
                              className="w-6 h-6 bg-slate-700 hover:bg-red-700 text-slate-300 rounded text-xs">−</button>
                            <span className="text-white text-xs font-bold w-4 text-center">{p[stat]}</span>
                            <button onClick={() => adjustStat(i, stat, 1)}
                              className="w-6 h-6 bg-slate-700 hover:bg-green-700 text-slate-300 rounded text-xs">+</button>
                          </div>
                        ))}
                      </div>

                      <div>
                        <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1.5">Títulos (+2 VP cada uno)</div>
                        <div className="flex gap-2">
                          {[["largestArmy", "⚔️ Ejército", largestArmy], ["longestRoad", "🛤️ Camino", longestRoad]].map(([key, label, holder]) => {
                            const manual = game.titles?.[key] === i;
                            const auto = !manual && holder === i;
                            return (
                              <button key={key} onClick={() => assignTitle(key, manual ? null : i)}
                                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${manual ? "bg-amber-500 text-slate-900" : auto ? "bg-slate-700 text-amber-300" : "bg-slate-700 hover:bg-slate-600 text-slate-300"}`}>
                                {manual ? `${label} ✓ manual` : auto ? `${label} (auto)` : `Asignar ${label}`}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-muted text-[10px] mt-1.5">La app no ve el tablero: si el camino más largo no coincide con el conteo, asignalo a mano. Tocá de nuevo para volver al automático.</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── LOG ── */}
          {/* ── STATS ── */}
          {/* En vivo durante toda la partida: es el mismo panel que se muestra
              al terminar, no una pantalla de cierre. */}
          {tab === "stats" && (
            <StatsPanel
              stats={matchStats}
              players={players}
              finalScores={finalScores}
              scoreOrder={scoreOrder}
              longestRoad={longestRoad}
              largestArmy={largestArmy}
              diceHistory={diceHistory}
              winningScore={WINNING_SCORE}
              showDice
            />
          )}

          {tab === "log" && (
            <div className="space-y-1">
              {log.length === 0 ? (
                <p className="log-entry">El historial aparecerá acá</p>
              ) : log.map((l, i) => (
                <div key={i} className="log-entry"><b>{new Date(l.t).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})}</b> {l.m}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════
          MODALS
         ═══════════════════════════════════════════════ */}
      {modal && (
        <div className="fixed inset-0 bg-black/70 z-40 flex items-end sm:items-center justify-center p-4">
          <div className="bg-slate-800 rounded-t-3xl sm:rounded-3xl p-6 w-full max-w-md max-h-[85vh] overflow-y-auto border border-slate-600">

            {/* Online room */}
            {modal.type === "online" && (
              <div>
                <h3 className="text-xl font-bold text-blue-400 mb-2">🌐 Partida online</h3>
                {!online.room ? (
                  <div>
                    <p className="text-slate-300 text-sm mb-4">
                      Creá una sala para que los demás sigan la partida desde su celular:
                      cada uno reclama su jugador, ve su mano y juega su turno
                      (construir, comerciar, terminar turno).
                    </p>
                    <button onClick={createOnlineRoom}
                      className="w-full py-3 bg-blue-500 hover:bg-blue-400 text-white font-bold rounded-xl mb-2">
                      Crear sala
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="bg-slate-900/70 border border-blue-500/40 rounded-2xl p-4 mb-4 text-center">
                      <p className="text-slate-400 text-xs mb-1 uppercase tracking-wider">Código para unirse</p>
                      <p className="text-3xl font-black text-blue-300 tracking-[.35em]">{online.room.code}</p>
                      <p className={`text-xs mt-2 font-semibold ${online.connected ? "text-emerald-400" : "text-red-400"}`}>
                        {online.connected ? "● Conectado" : "● Sin conexión"}
                        {online.pendingCount > 0 && ` · ${online.pendingCount} acción(es) por sincronizar`}
                      </p>
                    </div>

                    <button onClick={shareRoomCode}
                      className="w-full py-2.5 mb-4 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-400/40 text-blue-200 font-bold rounded-xl text-sm transition-all">
                      📤 Compartir código
                    </button>

                    <p className="text-slate-300 text-sm font-semibold mb-2">¿Qué jugador sos?</p>
                    <div className="space-y-2 mb-4">
                      {players.map((p, i) => {
                        const owner = online.members.find(m => m.player_index === i);
                        const isMine = online.myPlayerIndex === i;
                        const taken = owner && owner.user_id !== online.userId;
                        return (
                          <button key={i}
                            disabled={taken}
                            onClick={() => online.claimPlayer(isMine ? null : i, p.name)}
                            className={`w-full py-2.5 px-3 rounded-xl flex items-center gap-3 text-sm font-semibold transition-all ${isMine ? "bg-blue-500/25 ring-1 ring-blue-400 text-white" : taken ? "bg-slate-700/50 text-muted cursor-not-allowed" : "bg-slate-700 hover:bg-slate-600 text-white"}`}>
                            <span className="w-4 h-4 rounded-full" style={{backgroundColor: COLORS[p.ci].h}} />
                            <span>{p.name}</span>
                            {isMine && <span className="ml-auto text-blue-300 text-xs">✓ vos</span>}
                            {taken && <span className="ml-auto text-muted text-xs">ocupado</span>}
                          </button>
                        );
                      })}
                    </div>

                    <p className="text-muted text-xs mb-4">
                      Con jugador reclamado, tu celular juega solo en tu turno. Un celular sin
                      jugador reclamado controla la mesa completa (útil si a alguien se le apaga el teléfono).
                    </p>

                    <button onClick={() => { online.leaveRoom(); showNotif("Saliste de la sala (la partida sigue local)"); }}
                      className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-400 rounded-xl text-sm mb-2">
                      Salir de la sala
                    </button>
                  </div>
                )}
                <button onClick={() => setModal(null)} className="w-full py-3 bg-slate-700 text-slate-300 rounded-xl font-bold mt-1">
                  Cerrar
                </button>
              </div>
            )}

            {/* Undo confirmation */}
            {modal.type === "undo" && (() => {
              const eff = effectiveActions(actions);
              const last = eff[eff.length - 1];
              // Estado tal como quedaría después del undo = estado previo a `last`.
              const preState = replayActions([...actions, { type: "UNDO" }]);
              return (
                <div>
                  <h3 className="text-xl font-bold text-amber-400 mb-2">↩️ Deshacer última acción</h3>
                  <p className="text-slate-300 text-sm mb-1">Se va a deshacer:</p>
                  <div className="bg-slate-700/50 rounded-xl p-3 mb-4">
                    <span className="text-white font-semibold">{describeAction(last, preState)}</span>
                  </div>
                  <p className="text-slate-400 text-xs mb-4">El estado del juego vuelve exactamente a como estaba antes de esa acción.</p>
                  <div className="flex gap-2">
                    <button onClick={() => setModal(null)} className="flex-1 py-3 bg-slate-700 text-slate-300 rounded-xl font-bold">
                      Cancelar
                    </button>
                    <button onClick={doUndo}
                      className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-xl font-bold">
                      Deshacer
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Confirm build */}
            {modal.type === "confirmBuild" && (() => {
              const type = modal.buildType;
              const cost = COSTS[type];
              return (
                <div>
                  <h3 className="text-xl font-bold text-amber-400 mb-2">Confirmar construcción</h3>
                  <p className="text-slate-300 text-sm mb-4">
                    Vas a construir <span className="font-semibold text-white">{COST_EMOJI[type]} {COST_NAMES[type]}</span>.
                  </p>
                  {mode.enforceCosts && (
                    <div className="bg-slate-700/50 rounded-2xl p-4 mb-4">
                      <div className="text-slate-300 text-sm mb-2">Costo:</div>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(cost).map(([r, v]) => (
                          <ResBadge key={r} id={r} count={v} />
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => setModal(null)} className="flex-1 py-3 bg-slate-700 text-slate-300 rounded-xl font-bold">
                      Cancelar
                    </button>
                    <button
                      onClick={() => {
                        // Para acciones que no abren otro modal, cerramos DESPUÉS.
                        if (type === "camino") {
                          doBuild(type);
                          setModal(null);
                        } else {
                          setModal(null);
                          doBuild(type);
                        }
                      }}
                      className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-xl font-bold"
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Consultor de reglas */}
            {modal.type === "rules" && (
              <div>
                <h3 className="text-xl font-bold text-amber-400 mb-1">❓ Reglas de Catán</h3>
                <p className="text-slate-400 text-xs mb-3">Preguntá una duda puntual para seguir jugando.</p>

                <div className="bg-slate-900/60 rounded-2xl p-3 mb-3 max-h-64 overflow-y-auto space-y-2">
                  {rulesMsgs.length === 0 && !rulesBusy && (
                    <div className="space-y-1.5">
                      <p className="text-muted text-xs mb-2">Por ejemplo:</p>
                      {[
                        "¿Puedo jugar dos cartas de desarrollo en el mismo turno?",
                        "¿El ladrón puede quedarse en el desierto?",
                        "¿Cómo se cuenta el camino más largo si se corta?",
                      ].map(q => (
                        <button key={q} onClick={() => askRules(q)}
                          className="w-full text-left text-xs bg-slate-700/60 hover:bg-slate-700 text-slate-300 rounded-lg px-3 py-2 transition-all">
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                  {rulesMsgs.map((m, i) => (
                    <div key={i} className={`text-sm rounded-xl px-3 py-2 ${m.role === "user"
                      ? "bg-blue-500/20 text-blue-100 ml-6"
                      : m.isError ? "bg-red-900/30 text-red-200 mr-6" : "bg-slate-700/60 text-slate-100 mr-6"}`}>
                      {m.content}
                    </div>
                  ))}
                  {rulesBusy && <div className="text-muted text-sm px-3 py-2">Consultando…</div>}
                </div>

                <form onSubmit={(e) => { e.preventDefault(); askRules(); }} className="flex gap-2">
                  <input
                    value={rulesQ}
                    onChange={e => setRulesQ(e.target.value)}
                    placeholder="Tu pregunta…"
                    maxLength={500}
                    className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-sm focus:border-amber-500 focus:outline-none"
                  />
                  <button type="submit" disabled={rulesBusy || !rulesQ.trim()}
                    className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl transition-all">
                    Preguntar
                  </button>
                </form>

                <button onClick={() => setModal(null)} className="w-full py-3 mt-2 bg-slate-700 text-slate-300 rounded-xl font-bold">
                  Cerrar
                </button>
              </div>
            )}

            {/* Jugar (o revelar) una carta de la mano */}
            {modal.type === "playDev" && (() => {
              const owner = inRoomAsPlayer && players[myIdx] ? players[myIdx] : cur;
              return (
                <div>
                  <h3 className="text-xl font-bold text-purple-400 mb-2">🃏 Jugar una carta</h3>
                  <p className="text-slate-300 text-sm mb-4">
                    Tus cartas. Un punto de victoria se revela para acreditarlo; el resto se juega una por turno.
                  </p>
                  <div className="space-y-2 mb-3">
                    {owner.devCards.length === 0 && (
                      <p className="text-muted text-sm">No tenés cartas.</p>
                    )}
                    {owner.devCards.map((c, i) => {
                      // Recién comprada: todavía no se puede usar.
                      const fresca = owner.devCardBought.includes(c);
                      const usada = owner.devCardPlayed && c !== "victoria";
                      const bloqueada = fresca || usada;
                      return (
                        <button key={i} disabled={bloqueada} onClick={() => playDevCard(c, i)}
                          className="w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl p-3 flex items-center gap-3 text-left transition-all">
                          <span className="text-2xl">{DC[c].e}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-white text-sm font-bold">{DC[c].n}</div>
                            <div className="text-slate-400 text-xs">
                              {bloqueada ? (fresca ? "La levantaste este turno" : "Ya jugaste una carta este turno") : DC[c].d}
                            </div>
                          </div>
                          <span className="text-xs text-purple-300 font-bold whitespace-nowrap">
                            {c === "victoria" ? "Revelar" : "Jugar"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={() => setModal(null)} className="w-full py-3 bg-slate-700 text-slate-300 rounded-xl font-bold">
                    Cerrar
                  </button>
                </div>
              );
            })()}

            {/* Elegir qué carta de desarrollo salió del mazo físico */}
            {modal.type === "pickDev" && (
              <div>
                <h3 className="text-xl font-bold text-purple-400 mb-2">🃏 ¿Qué carta salió?</h3>
                <p className="text-slate-300 text-sm mb-4">Elegí la carta que sacaste del mazo de la mesa, así tu mano en la app coincide con la real.</p>
                <div className="space-y-2 mb-3">
                  {Object.entries(DC).map(([key, c]) => {
                    const left = deck.filter(d => d === key).length;
                    return (
                      <button key={key} onClick={() => buyDevCard(key)}
                        className="w-full bg-slate-700 hover:bg-slate-600 rounded-xl p-3 flex items-center gap-3 text-left transition-all">
                        <span className="text-2xl">{c.e}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-white text-sm font-bold">{c.n}</div>
                          <div className="text-slate-400 text-xs">{c.d}</div>
                        </div>
                        <span className="text-muted text-xs whitespace-nowrap">{left} en mazo</span>
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => setModal(null)} className="w-full py-3 bg-slate-700 text-slate-300 rounded-xl font-bold">
                  Cancelar
                </button>
              </div>
            )}

            {/* Discard modal */}
            {modal.type === "discard" && (() => {
              const pIdx = modal.queue[modal.current];
              const p = players[pIdx];
              const mustDiscard = Math.floor(totalC(p.hand) / 2);
              const discarded = totalC(modalDiscards);
              return (
                <div>
                  <h3 className="text-xl font-bold text-red-400 mb-2">🦹 ¡Salió 7!</h3>
                  {/* Summary: who has too many cards and must discard */}
                  <div className="bg-slate-900/60 border border-red-900/40 rounded-xl p-3 mb-4">
                    <div className="text-xs font-bold uppercase tracking-wider text-red-300/80 mb-2">Descartes pendientes</div>
                    <div className="flex flex-col gap-1.5">
                      {modal.queue.map((qIdx, qPos) => {
                        const qp = players[qIdx];
                        const qTotal = totalC(qp.hand);
                        const qMust = Math.floor(qTotal / 2);
                        const done = qPos < modal.current;
                        const active = qPos === modal.current;
                        return (
                          <div key={qIdx} className={`flex items-center justify-between text-sm rounded-lg px-2 py-1 ${active ? "bg-red-900/30 ring-1 ring-red-500/40" : done ? "opacity-50" : ""}`}>
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full" style={{backgroundColor:COLORS[qp.ci].h}} />
                              <span className="text-white font-semibold">{qp.name}</span>
                              <span className="text-slate-400 text-xs">({qTotal}🃏)</span>
                              {done && <span className="text-emerald-400 text-xs">✓</span>}
                              {active && <span className="text-amber-300 text-xs font-bold">← ahora</span>}
                            </div>
                            <span className={`text-xs font-bold ${active ? "text-amber-300" : "text-slate-300"}`}>−{qMust}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <p className="text-slate-300 mb-1">{p.name} tiene {totalC(p.hand)} cartas.</p>
                  <p className="text-slate-400 text-sm mb-4">Debe descartar {mustDiscard} cartas ({discarded}/{mustDiscard})</p>
                  <div className="space-y-2 mb-4">
                    {RES.map(r => p.hand[r.id] > 0 && (
                      <div key={r.id} className="flex items-center justify-between">
                        <ResBadge id={r.id} count={p.hand[r.id]} />
                        <div className="flex items-center gap-2">
                          <button onClick={() => setModalDiscards(d => ({ ...d, [r.id]: Math.max(0, d[r.id] - 1) }))}
                            className="w-8 h-8 bg-slate-700 hover:bg-slate-600 text-white rounded-lg">−</button>
                          <span className="text-white font-bold w-6 text-center">{modalDiscards[r.id]}</span>
                          <button onClick={() => setModalDiscards(d => ({ ...d, [r.id]: Math.min(p.hand[r.id], d[r.id] + 1) }))}
                            disabled={discarded >= mustDiscard}
                            className="w-8 h-8 bg-slate-700 hover:bg-slate-600 text-white rounded-lg disabled:opacity-30">+</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button disabled={discarded !== mustDiscard}
                    onClick={() => {
                      applyDiscard(pIdx, modalDiscards);
                      if (modal.current < modal.queue.length - 1) {
                        setModalDiscards(eHand());
                        setModal(prev => ({ ...prev, current: prev.current + 1 }));
                      } else if (canAct) {
                        // El ladrón lo mueve quien tiró: si este celular solo
                        // descartó lo suyo, cierra y listo.
                        setModal({ type: "robber" });
                      } else {
                        setModal(null);
                      }
                    }}
                    className={`w-full py-3 rounded-xl font-bold ${discarded === mustDiscard ? "bg-red-600 hover:bg-red-600 text-white" : "bg-slate-700 text-muted cursor-not-allowed"}`}>
                    Descartar
                  </button>
                </div>
              );
            })()}

            {/* Robber placement */}
            {modal.type === "robber" && (() => {
              // El ladrón bloquea UN hexágono: número + recurso. Se marcan los
              // recursos que realmente están en juego con ese número.
              const inPlay = new Set(players.flatMap(p =>
                p.productions.filter(pr => pr.num === modal.num).map(pr => pr.res)));

              // Paso 3: varios jugadores comparten ese número+recurso, así que
              // puede haber dos hexágonos iguales. Se elige a cuáles toca este.
              if (modal.sel) {
                const toggle = (i) => setModal(m => ({
                  ...m,
                  sel: m.sel.includes(i) ? m.sel.filter(x => x !== i) : [...m.sel, i],
                }));
                return (
                  <div>
                    <h3 className="text-xl font-bold text-red-400 mb-2">🦹 ¿A quiénes toca ese hexágono?</h3>
                    <p className="text-slate-300 text-sm mb-1">
                      Hay varios jugadores con el <b className="text-white">{modal.num} {RM[modal.res]?.e}</b>.
                    </p>
                    <p className="text-slate-400 text-xs mb-4">
                      Si son dos hexágonos distintos, dejá marcados solo los que tocan el que estás bloqueando.
                    </p>
                    <div className="space-y-2 mb-4">
                      {playersOnHex(modal.num, modal.res).map(i => (
                        <button key={i} onClick={() => toggle(i)}
                          className={`w-full py-2.5 px-3 rounded-xl flex items-center gap-3 text-sm font-semibold transition-all ${modal.sel.includes(i) ? "bg-red-500/25 ring-1 ring-red-400 text-white" : "bg-slate-700 text-slate-400"}`}>
                          <span className={`w-5 h-5 rounded flex items-center justify-center text-xs font-black ${modal.sel.includes(i) ? "bg-red-600 text-white" : "bg-slate-600 text-muted"}`}>
                            {modal.sel.includes(i) ? "✓" : ""}
                          </span>
                          <span className="w-4 h-4 rounded-full" style={{ backgroundColor: COLORS[players[i].ci].h }} />
                          <span>{players[i].name}</span>
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setModal(m => ({ ...m, res: undefined, sel: undefined }))}
                        className="py-3 px-4 bg-slate-700 text-slate-300 rounded-xl font-bold text-sm">
                        ← Atrás
                      </button>
                      <button onClick={() => placeRobber(modal.num, modal.res, modal.sel)}
                        disabled={modal.sel.length === 0}
                        className="flex-1 py-3 bg-red-500 hover:bg-red-400 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl font-bold">
                        Bloquear
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div>
                  <h3 className="text-xl font-bold text-red-400 mb-2">🦹 Colocar el ladrón</h3>
                  <p className="text-slate-300 text-sm mb-3">
                    {modal.num ? "Ahora elegí el recurso de ese hexágono." : "Elegí el número del hexágono donde va el ladrón."}
                  </p>
                  <div className="grid grid-cols-5 gap-2 mb-4">
                    {NUMS.map(n => (
                      <button key={n} onClick={() => setModal(m => ({ ...m, num: n }))}
                        className={`py-3 rounded-xl font-bold text-lg transition-all ${n === modal.num ? "bg-red-600 text-white ring-2 ring-red-300" : "bg-slate-700 hover:bg-slate-600 text-white"}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                  {modal.num && (
                    <>
                      <p className="text-slate-400 text-xs mb-2">Hexágono con el <b className="text-white">{modal.num}</b> — recurso:</p>
                      <div className="grid grid-cols-1 gap-2 mb-3">
                        {RES.map(r => {
                          const n = playersOnHex(modal.num, r.id).length;
                          return (
                            <button key={r.id} onClick={() => chooseRobberRes(modal.num, r.id)}
                              className={`${r.bg} ${r.tx} py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 ${inPlay.has(r.id) ? "ring-2 ring-amber-300" : "opacity-70"}`}>
                              {r.e} {r.n}
                              {n > 0 && <span className="text-xs font-semibold">· {n} jugador{n === 1 ? "" : "es"}</span>}
                            </button>
                          );
                        })}
                      </div>
                      <button onClick={() => placeRobber(modal.num, null, null)}
                        className="w-full py-2 mb-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-sm">
                        Bloquear todos los {modal.num} (no sé el recurso)
                      </button>
                    </>
                  )}
                  <button onClick={() => { setModal(null); }} className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-sm">
                    Saltar (sin ladrón)
                  </button>
                </div>
              );
            })()}

            {/* Steal */}
            {modal.type === "steal" && (
              <div>
                <h3 className="text-xl font-bold text-red-400 mb-2">🦹 Robar una carta</h3>
                <p className="text-slate-300 text-sm mb-4">Elegí a quién le robás una carta al azar.</p>
                <div className="space-y-2">
                  {modal.victims.map(vi => (
                    <button key={vi} onClick={() => stealFrom(vi)}
                      className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl flex items-center gap-3 px-4">
                      <div className="w-6 h-6 rounded-full" style={{backgroundColor:COLORS[players[vi].ci].h}} />
                      <span>{players[vi].name}</span>
                      <span className="text-slate-400 text-sm ml-auto">({totalC(players[vi].hand)} cartas)</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => setModal(null)} className="w-full py-2 bg-slate-700 text-slate-400 rounded-xl text-sm mt-3">
                  No robar
                </button>
              </div>
            )}

            {/* Monopoly */}
            {modal.type === "monopoly" && (
              <div>
                <h3 className="text-xl font-bold text-purple-400 mb-2">👑 Monopolio</h3>
                <p className="text-slate-300 text-sm mb-4">Elegí un recurso. Todos los jugadores te dan todas sus cartas de ese tipo.</p>
                <div className="grid grid-cols-1 gap-2">
                  {RES.map(r => (
                    <button key={r.id} onClick={() => applyMonopoly(r.id)}
                      className={`${r.bg} ${r.tx} py-3 rounded-xl font-bold text-lg`}>
                      {r.e} {r.n}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Year of Plenty */}
            {modal.type === "yearOfPlenty" && (
              <div>
                <h3 className="text-xl font-bold text-green-400 mb-2">🎁 Año de Abundancia</h3>
                <p className="text-slate-300 text-sm mb-4">Elegí recurso ({(modal.picks || 0) + 1} de 2)</p>
                <div className="grid grid-cols-1 gap-2">
                  {RES.map(r => (
                    <button key={r.id} onClick={() => applyYearOfPlenty(r.id)}
                      className={`${r.bg} ${r.tx} py-3 rounded-xl font-bold text-lg`}>
                      {r.e} {r.n}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* New settlement */}
            {(modal.type === "newSettlement" || modal.type === "freeSettlement") && (() => {
              const targetIdx = modal.type === "freeSettlement" ? modal.playerIdx : cp;
              return (
                <div>
                  <h3 className="text-xl font-bold text-green-400 mb-2">{modal.isCity ? "🏙️ Nueva ciudad" : "🏠 Nuevo poblado"}</h3>
                  <p className="text-slate-300 text-sm mb-4">
                    {modal.type === "freeSettlement" ? `Para ${players[targetIdx].name}. ` : ""}
                    Agregá los hexágonos adyacentes (1-3).
                  </p>
                  <div className="space-y-2 mb-4">
                    {modalHexes.map((h, i) => (
                      <div key={i} className="flex gap-2">
                        <select value={h.num} aria-label={`Número del hexágono ${i + 1}`}
                          onChange={e => { const nh = [...modalHexes]; nh[i] = { ...nh[i], num: e.target.value }; setModalHexes(nh); }}
                          className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600">
                          <option value="">Nro</option>
                          {NUMS.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <select value={h.res} aria-label={`Recurso del hexágono ${i + 1}`}
                          onChange={e => { const nh = [...modalHexes]; nh[i] = { ...nh[i], res: e.target.value }; setModalHexes(nh); }}
                          className="flex-1 bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600">
                          <option value="">Recurso</option>
                          {RES.map(r => <option key={r.id} value={r.id}>{r.e} {r.n}</option>)}
                        </select>
                        {modalHexes.length > 1 && (
                          <button onClick={() => setModalHexes(modalHexes.filter((_, j) => j !== i))} className="text-red-400 px-2">✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                  {modalHexes.length < 3 && (
                    <button onClick={() => setModalHexes([...modalHexes, { num: "", res: "" }])}
                      className="text-sm text-amber-400 hover:text-amber-300 mb-4 block">+ Agregar hexágono</button>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => setModal(null)} className="flex-1 py-3 bg-slate-700 text-slate-300 rounded-xl font-bold">Cancelar</button>
                    <button disabled={!modalHexes.some(h => h.num && h.res)}
                      onClick={() => {
                        if (modal.type === "freeSettlement") addFreeProductions(targetIdx, modalHexes, modal.isCity);
                        else addSettlement(modalHexes);
                      }}
                      className="flex-1 py-3 bg-green-500 hover:bg-green-400 text-slate-900 rounded-xl font-bold disabled:opacity-30">
                      Confirmar
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Upgrade to city */}
            {modal.type === "upgradeCity" && (() => {
              const groups = getSettlementGroups(builder).filter(g => !g.isCity);
              return (
                <div>
                  <h3 className="text-xl font-bold text-amber-400 mb-2">🏙️ Mejorar a ciudad</h3>
                  <p className="text-slate-300 text-sm mb-4">Elegí qué poblado mejorar. Producirá el doble.</p>
                  {groups.length === 0 ? (
                    <p className="text-muted">No tenés poblados para mejorar.</p>
                  ) : (
                    <div className="space-y-2">
                      {groups.map(g => (
                        <button key={g.gid} onClick={() => upgradeToCity(g.gid)}
                          className="w-full bg-slate-700 hover:bg-slate-600 rounded-xl p-3 flex items-center gap-2">
                          <span>🏠</span>
                          {g.hexes.map(h => (
                            <span key={h.id} className={`${RM[h.res].bg} ${RM[h.res].tx} px-2 py-0.5 rounded text-xs`}>
                              {h.num} {RM[h.res].e}
                            </span>
                          ))}
                          <span className="text-amber-400 ml-auto">→ 🏙️</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={() => setModal(null)} className="w-full py-2 bg-slate-700 text-slate-400 rounded-xl text-sm mt-3">Cancelar</button>
                </div>
              );
            })()}

            {/* Marcar ciudad (corrección, cualquier jugador) */}
            {modal.type === "cityFree" && (() => {
              const target = players[modal.playerIdx];
              const groups = getSettlementGroups(target).filter(g => !g.isCity);
              return (
                <div>
                  <h3 className="text-xl font-bold text-amber-400 mb-2">🏙️ Marcar ciudad</h3>
                  <p className="text-slate-300 text-sm mb-4">Elegí qué poblado de <b>{target.name}</b> ya es ciudad. Sin costo (corrección).</p>
                  <div className="space-y-2">
                    {groups.map(g => (
                      <button key={g.gid} onClick={() => upgradeCityFree(modal.playerIdx, g.gid)}
                        className="w-full bg-slate-700 hover:bg-slate-600 rounded-xl p-3 flex items-center gap-2">
                        <span>🏠</span>
                        {g.hexes.map(h => (
                          <span key={h.id} className={`${RM[h.res].bg} ${RM[h.res].tx} px-2 py-0.5 rounded text-xs`}>
                            {h.num} {RM[h.res].e}
                          </span>
                        ))}
                        <span className="text-amber-400 ml-auto">→ 🏙️</span>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => { setModal(null); addFreeSettlement(modal.playerIdx, true); }}
                    className="w-full py-2 mt-3 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-sm">
                    + Cargar una ciudad nueva con sus hexágonos
                  </button>
                  <button onClick={() => setModal(null)} className="w-full py-2 bg-slate-700 text-slate-400 rounded-xl text-sm mt-2">Cancelar</button>
                </div>
              );
            })()}

            {/* Player trade */}
            {modal.type === "playerTrade" && (() => {
              const canTrade = totalC(tradeGive) > 0 && totalC(tradeReceive) > 0 &&
                Object.entries(tradeGive).every(([r, v]) => cur.hand[r] >= v) &&
                Object.entries(tradeReceive).every(([r, v]) => players[tradeOther]?.hand[r] >= v);
              return (
                <div>
                  <h3 className="text-xl font-bold text-blue-400 mb-4">🤝 Comerciar con jugador</h3>
                  <div className="mb-4">
                    <label className="text-slate-400 text-sm">Comerciar con:</label>
                    <div className="flex gap-2 mt-1">
                      {players.map((p, i) => i !== cp && (
                        <button key={i} onClick={() => setTradeOther(i)}
                          className="px-3 py-1.5 rounded-lg text-sm font-medium text-white"
                          style={{backgroundColor: i === tradeOther ? COLORS[p.ci].h : "#334155"}}>
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <p className="text-red-400 text-sm font-medium mb-2">Dás:</p>
                      {RES.map(r => (
                        <div key={r.id} className="flex items-center justify-between py-1">
                          <span className="text-xs">{r.e}</span>
                          <div className="flex items-center gap-1">
                            <button onClick={() => setTradeGive(g => ({ ...g, [r.id]: Math.max(0, g[r.id] - 1) }))} className="w-6 h-6 bg-slate-700 rounded text-white text-xs">−</button>
                            <span className="text-white text-sm w-4 text-center">{tradeGive[r.id]}</span>
                            <button onClick={() => setTradeGive(g => ({ ...g, [r.id]: Math.min(cur.hand[r.id], g[r.id] + 1) }))} className="w-6 h-6 bg-slate-700 rounded text-white text-xs">+</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div>
                      <p className="text-green-400 text-sm font-medium mb-2">Recibís:</p>
                      {RES.map(r => (
                        <div key={r.id} className="flex items-center justify-between py-1">
                          <span className="text-xs">{r.e}</span>
                          <div className="flex items-center gap-1">
                            <button onClick={() => setTradeReceive(g => ({ ...g, [r.id]: Math.max(0, g[r.id] - 1) }))} className="w-6 h-6 bg-slate-700 rounded text-white text-xs">−</button>
                            <span className="text-white text-sm w-4 text-center">{tradeReceive[r.id]}</span>
                            <button onClick={() => setTradeReceive(g => ({ ...g, [r.id]: Math.min(players[tradeOther]?.hand[r.id] || 0, g[r.id] + 1) }))} className="w-6 h-6 bg-slate-700 rounded text-white text-xs">+</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setModal(null)} className="flex-1 py-3 bg-slate-700 text-slate-300 rounded-xl font-bold">Cancelar</button>
                    <button disabled={!canTrade} onClick={() => { doPlayerTrade(tradeOther, tradeGive, tradeReceive); setModal(null); }}
                      className="flex-1 py-3 bg-blue-500 hover:bg-blue-400 text-white rounded-xl font-bold disabled:opacity-30">
                      Confirmar
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
