import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { STYLE_CSS } from "./styles";
import { DiceFace, ResBadge } from "./components";
import {
  RES, RM, NUMS, COSTS, COST_NAMES, COST_EMOJI, INIT_DECK, DC, COLORS,
  playerMark, GAME_MODES, shuffle, rollDie, afford, totalC, eHand, dotStr,
} from "./game/constants";
import { computeGains, replayActions, effectiveActions } from "./game/reducer";
import { computeScores, computeLargestArmy, computeLongestRoad, WINNING_SCORE, isGameFinished } from "./game/selectors";
import { describeAction } from "./game/describe";
import { useGameLog, loadSavedGame, clearSavedActions } from "./game/useGameLog";
import { useOnlineRoom, loadSavedRoomCode } from "./online/useOnlineRoom";
import { useWakeLock, vibrate } from "./useWakeLock";

// Acciones de juego que solo despacha el jugador de turno (o un celular "mesa"
// sin jugador reclamado). Las de corrección también las puede hacer el host.
const TURN_ACTIONS = new Set([
  "ROLL", "DISCARD", "PLACE_ROBBER", "STEAL", "BUILD_ROAD", "ADD_SETTLEMENT",
  "UPGRADE_CITY", "BUY_DEV", "PLAY_DEV", "MONOPOLY", "YEAR_OF_PLENTY",
  "TRADE_BANK", "TRADE_PLAYER", "ADD_PORT", "REMOVE_PORT", "END_TURN",
]);
const FIX_ACTIONS = new Set(["MANUAL_ADJUST", "ADD_FREE_SETTLEMENT", "MOVE_PLAYER", "UNDO"]);

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
  const online = useOnlineRoom({
    onRemoteAction: dispatchAction,
    onResync: replaceActions,
  });

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
    if (online.room && online.myPlayerIndex !== null && online.myPlayerIndex !== game.cp) {
      if (FIX_ACTIONS.has(action.type)) {
        if (!online.room.isHost) {
          showNotif("Solo el anfitrión puede corregir fuera de su turno");
          return null;
        }
      } else if (TURN_ACTIONS.has(action.type)) {
        showNotif(`⏳ Es el turno de ${game.players[game.cp]?.name || "otro jugador"}`);
        return null;
      }
    }
    const stamped = dispatchAction(action);
    if (online.room) online.pushAction(stamped);
    return stamped;
  }, [dispatchAction, online.room, online.pushAction, online.myPlayerIndex, game.cp, game.players, showNotif]);

  // Partida guardada pendiente de retomar (si existe y no terminó)
  const [savedGame, setSavedGame] = useState(() => {
    const saved = loadSavedGame();
    if (!saved) return null;
    const state = replayActions(saved.actions);
    if (!state.started || isGameFinished(state)) return null;
    return { actions: saved.actions, state, roomCode: loadSavedRoomCode() };
  });

  // UI / setup state
  const [phase, setPhase] = useState("mode");
  const [gameMode, setGameMode] = useState("full");
  const [pCount, setPCount] = useState(3);
  const [setupPlayers, setSetupPlayers] = useState([]);
  const [setupIdx, setSetupIdx] = useState(0);
  const [setupData, setSetupData] = useState({});
  const [tab, setTab] = useState("dados");
  const [rolling, setRolling] = useState(false);
  const [manualPickerOpen, setManualPickerOpen] = useState(() => loadPrefManual());
  const [modal, setModal] = useState(null);
  const [winner, setWinner] = useState(null);
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

  const { players, cp, turnPhase, dice, deck, robber, turn, diceHistory, lastDistribution, log } = game;
  const mode = GAME_MODES[game.started ? game.gameMode : gameMode];

  // ── CONTROL POR TURNO (sala online) ──
  // Sin sala, o sin jugador reclamado (celular "mesa"): control total.
  const myIdx = online.myPlayerIndex;
  const inRoomAsPlayer = Boolean(online.room) && myIdx !== null;
  const isMyTurn = inRoomAsPlayer && myIdx === cp;
  const canAct = !inRoomAsPlayer || isMyTurn;
  const canFix = canAct || Boolean(online.room?.isHost);

  // La pantalla no se apaga durante la partida (se libera al terminar).
  useWakeLock(phase === "game" && game.started && winner === null);

  // ── SCORES (derivados del estado del juego) ──
  const scores = useMemo(() => computeScores(players), [players]);
  const largestArmy = useMemo(() => computeLargestArmy(players), [players]);
  const longestRoad = useMemo(() => computeLongestRoad(players), [players]);

  const finalScores = useMemo(() => scores.map((s, i) => {
    let v = s;
    if (largestArmy === i) v += 2;
    if (longestRoad === i) v += 2;
    return v;
  }), [scores, largestArmy, longestRoad]);

  // Dice history stats (2..12)
  const diceCounts = useMemo(() => {
    const c = {};
    for (let n = 2; n <= 12; n++) c[n] = 0;
    diceHistory.forEach(v => { if (c[v] !== undefined) c[v] += 1; });
    return c;
  }, [diceHistory]);

  // ── CHECK WIN ──
  useEffect(() => {
    const w = finalScores.findIndex(s => s >= WINNING_SCORE);
    if (w >= 0 && winner === null) setWinner(w);
  }, [finalScores, winner]);

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
  }, [game.started, cp, turn]);

  // ── CONTINUAR PARTIDA ──
  const continueSavedGame = () => {
    if (!savedGame) return;
    replaceActions(savedGame.actions);
    setWinner(null);
    setTab("dados");
    setPhase("game");
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
      players: setupPlayers.map(p => ({ name: p.name, ci: p.ci })),
      settlements: setupData,
      deck: shuffle([...INIT_DECK]),
    });
    setSavedGame(null);
    setWinner(null);
    setTab("dados");
    setPhase("game");
  };

  const newGame = () => {
    online.leaveRoom();
    resetGame();
    setWinner(null);
    setSetupPlayers([]);
    setSetupData({});
    setModal(null);
    setTab("dados");
    setPhase("mode");
  };

  // ── GAME HANDLERS ──
  const processRoll = (d1, d2, manual = false) => {
    const sum = d1 + d2;
    dispatch({ type: "ROLL", d1, d2, manual });
    vibrate(sum === 7 ? [70, 60, 140] : 60);

    if (sum === 7) {
      // Un 7 no modifica manos hasta el descarte, así que `players` (pre-acción) sirve.
      const needDiscard = players.map((p, i) => ({ idx: i, total: totalC(p.hand) })).filter(x => x.total > 7);
      if (needDiscard.length > 0) {
        setModalDiscards(eHand());
        setModal({ type: "discard", queue: needDiscard.map(x => x.idx), current: 0 });
      } else {
        setModal({ type: "robber" });
      }
    } else if (sum === robber) {
      showNotif(`⛔ El ladrón bloquea el ${sum}. Nadie recibe recursos.`);
    } else {
      const gains = computeGains(players, sum, robber);
      const receiving = gains.filter(g => totalC(g) > 0).length;
      if (receiving > 0) {
        showNotif(`📦 Recursos distribuidos (${receiving} jugador${receiving === 1 ? "" : "es"})`, 2500);
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

  const placeRobber = (num) => {
    dispatch({ type: "PLACE_ROBBER", num });
    // Check who to steal from
    const victims = [];
    players.forEach((p, i) => {
      if (i === cp) return;
      if (p.productions.some(pr => pr.num === num) && totalC(p.hand) > 0) victims.push(i);
    });
    if (victims.length > 0) {
      setModal({ type: "steal", victims });
    } else {
      setModal(null);
      showNotif(`Ladrón en el ${num}. No hay a quién robar.`);
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
    if (!canAct) {
      showNotif(`⏳ Es el turno de ${players[cp]?.name}`);
      return;
    }
    if (mode.enforceCosts) {
      if (turnPhase !== "rolled") {
        showNotif("Primero tirá los dados (y esperá a que se distribuyan recursos)");
        return;
      }
      const cost = COSTS[type];
      if (!afford(players[cp].hand, cost)) {
        showNotif("No se puede: te faltan recursos");
        return;
      }
    }
    setModal({ type: "confirmBuild", buildType: type });
  };

  const doBuild = (type) => {
    const cost = COSTS[type];
    if (mode.enforceCosts && !afford(players[cp].hand, cost)) { showNotif("No tenés suficientes recursos"); return; }

    if (type === "camino") {
      dispatch({ type: "BUILD_ROAD" });
      showNotif("Camino construido");
    } else if (type === "poblado") {
      setModalHexes([{ num: "", res: "" }]);
      setModal({ type: "newSettlement", building: "poblado" });
    } else if (type === "ciudad") {
      setModal({ type: "upgradeCity" });
    } else if (type === "desarrollo") {
      if (deck.length === 0) { showNotif("No quedan cartas de desarrollo"); return; }
      const card = deck[0];
      dispatch({ type: "BUY_DEV" });
      showNotif(`Compraste: ${DC[card].e} ${DC[card].n}`);
    }
  };

  const addSettlement = (hexes) => {
    dispatch({ type: "ADD_SETTLEMENT", hexes });
    showNotif("Poblado construido");
    setModal(null);
  };

  const upgradeToCity = (gidVal) => {
    dispatch({ type: "UPGRADE_CITY", gid: gidVal });
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
    if (players[cp].devCardBought.includes(cardType) && cardType !== "victoria") {
      showNotif("No podés jugar una carta comprada este turno");
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
    }
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

  const addFreeSettlement = (playerIdx) => {
    setModalHexes([{ num: "", res: "" }]);
    setModal({ type: "freeSettlement", playerIdx });
  };

  const addFreeProductions = (playerIdx, hexes) => {
    dispatch({ type: "ADD_FREE_SETTLEMENT", player: playerIdx, hexes });
    showNotif("Poblado agregado");
    setModal(null);
  };

  const manualAdjust = (playerIdx, res, delta) => {
    dispatch({ type: "MANUAL_ADJUST", player: playerIdx, res, delta });
  };

  // ── ONLINE: crear / unirse / reconectar ──
  const createOnlineRoom = async () => {
    try {
      const r = await online.createRoom(actions);
      showNotif(`🌐 Sala creada: ${r.code}`);
    } catch (e) {
      showNotif(`No se pudo crear la sala: ${e.message}`);
    }
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
      setSavedGame(null);
      setWinner(null);
      setTab("dados");
      setPhase("game");
      showNotif("🌐 Conectado a la sala");
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
                Turno {savedGame.state.turn} · Modo {savedGame.state.gameMode === "simple" ? "Simple" : "Completo"}
              </p>
              <div className="flex gap-2">
                <button onClick={continueSavedGame}
                  className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-white font-bold rounded-xl transition-all">
                  ▶️ Continuar
                </button>
                <button onClick={discardSavedGame}
                  className="py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-semibold rounded-xl transition-all">
                  Descartar
                </button>
              </div>
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
            className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-white font-bold rounded-xl text-lg transition-all shadow-lg shadow-amber-500/20">
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
            <button key={n} onClick={() => setPCount(n)}
              className={`w-14 h-14 rounded-xl text-xl font-bold transition-all ${pCount === n ? "bg-amber-500 text-white scale-110 shadow-lg shadow-amber-500/30" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>
              {n}
            </button>
          ))}
        </div>
        <button onClick={initPlayers}
          className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-white font-bold rounded-xl text-lg transition-all shadow-lg shadow-amber-500/20">
          Siguiente →
        </button>
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
          className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-white font-bold rounded-xl text-lg transition-all">
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
                      <select value={hex.num} onChange={e => updateHex(si, hi, "num", e.target.value)}
                        className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:border-amber-500 focus:outline-none">
                        <option value="">Nro</option>
                        {NUMS.map(n => <option key={n} value={n}>{n} {dotStr(n)}</option>)}
                      </select>
                      <select value={hex.res} onChange={e => updateHex(si, hi, "res", e.target.value)}
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
                  className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-white font-bold rounded-xl transition-all">
                  Siguiente →
                </button>
              ) : (
                <button onClick={startGame}
                  className="flex-1 py-3 bg-green-500 hover:bg-green-400 text-white font-bold rounded-xl transition-all text-lg">
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
  //  RENDER: GAME
  // ═══════════════════════════════════════════════
  if (phase !== "game" || !game.started) return null;
  const cur = players[cp];
  const diceSum = dice[0] + dice[1];

  const TABS = [
    { id: "dados", label: "Dados", e: "🎲" },
    { id: "construir", label: "Construir", e: "🏗️" },
    { id: "comerciar", label: "Comerciar", e: "🔄" },
    { id: "cartas", label: "Cartas", e: "🃏", hideInSimple: true },
    { id: "jugadores", label: "Jugadores", e: "👥" },
    { id: "log", label: "Log", e: "📋" },
  ].filter(t => mode.showDevCards || !t.hideInSimple);

  // Group settlements for display
  const getSettlementGroups = (p) => {
    const groups = {};
    p.productions.forEach(pr => {
      if (!groups[pr.gid]) groups[pr.gid] = { hexes: [], isCity: false, gid: pr.gid };
      groups[pr.gid].hexes.push(pr);
      if (pr.isCity) groups[pr.gid].isCity = true;
    });
    return Object.values(groups);
  };

  return (
    <div className="catan-app flex flex-col">
      <style>{STYLE_CSS}</style>
      <div className="flex flex-col flex-1 min-h-screen" style={{position:"relative",zIndex:1}}>
      {/* Winner overlay */}
      {winner !== null && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-3xl p-8 text-center max-w-md border-2 border-amber-500">
            <div className="text-6xl mb-4">🏆</div>
            <h2 className="text-3xl font-bold text-amber-400 mb-2">¡{players[winner].name} gana!</h2>
            <p className="text-slate-300 text-lg mb-6">{finalScores[winner]} puntos de victoria</p>
            <button onClick={newGame}
              className="px-6 py-3 bg-amber-500 text-white font-bold rounded-xl">Nueva partida</button>
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
              <span className="text-slate-400 text-sm ml-2">Turno {turn}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ml-2 uppercase tracking-wider ${game.gameMode === "simple" ? "bg-slate-700 text-slate-300" : "bg-amber-900/60 text-amber-300"}`}>
                {game.gameMode === "simple" ? "Simple" : "Completo"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {robber && <span className="text-xs bg-red-900 text-red-300 px-2 py-1 rounded-full">🦹 {robber}</span>}
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
            {canUndo && canFix && (
              <button onClick={requestUndo}
                className="w-8 h-8 flex items-center justify-center bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-base transition-all"
                title="Deshacer última acción">
                ↩️
              </button>
            )}
            {turnPhase === "rolled" && canAct && (
              <button onClick={endTurn}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-white font-bold rounded-lg text-sm transition-all">
                Fin turno →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scores bar */}
      <div className="bg-slate-800/50 border-b border-slate-700/50 px-4 py-2 overflow-x-auto">
        <div className="flex gap-4 max-w-2xl mx-auto px-2">
          {players.map((p, i) => (
            <div key={i} className={`flex items-center gap-2 text-sm whitespace-nowrap ${i === cp ? "opacity-100" : "opacity-60"}`}>
              <div className="w-3 h-3 rounded-full" style={{backgroundColor:COLORS[p.ci].h}} />
              <span className="text-white font-medium">{p.name}</span>
              <span className="text-amber-400 font-bold">{finalScores[i]}VP</span>
              {largestArmy === i && <span title="Ejército más grande">⚔️</span>}
              {longestRoad === i && <span title="Camino más largo">🛤️</span>}
              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${totalC(p.hand) > 7 ? "bg-red-900/50 text-red-300" : "text-slate-400"}`} title={totalC(p.hand) > 7 ? "Más de 7 cartas: se descarta si sale 7" : "Cartas en mano"}>{totalC(p.hand)}🃏</span>
            </div>
          ))}
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

              {/* Historial de números (tipo ruleta) */}
              <div className="bg-slate-800 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-slate-300 font-semibold">Historial de tiradas</h3>
                  <span className="text-slate-500 text-xs">últimas {Math.min(12, diceHistory.length)}/12</span>
                </div>
                {diceHistory.length === 0 ? (
                  <p className="text-slate-500 text-sm">Todavía no hay tiradas en esta partida.</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {diceHistory.slice(0, 12).map((n, i) => (
                        <span key={i} className={`px-3 py-1 rounded-full text-sm font-bold ${i === 0 ? "bg-amber-500 text-white" : "bg-slate-700 text-slate-200"}`}>
                          {n}
                        </span>
                      ))}
                    </div>

                    <div className="grid grid-cols-11 gap-1 items-end">
                      {Array.from({ length: 11 }, (_, k) => k + 2).map(n => {
                        const v = diceCounts[n] || 0;
                        return (
                          <div key={n} className="flex flex-col items-center gap-1">
                            <div
                              className="w-full bg-slate-700 rounded-md"
                              style={{ height: `${Math.min(44, 6 + v * 6)}px` }}
                              title={`${n}: ${v}`}
                            />
                            <span className="text-[10px] text-slate-400">{n}</span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-slate-500 text-xs mt-3">Tip: 6 y 8 son los números más probables. Este gráfico es el historial real de la partida.</p>
                  </>
                )}
              </div>

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
            </div>
          )}

          {/* ── CONSTRUIR ── */}
          {tab === "construir" && (
            <div className="space-y-4">
              <h3 className="text-slate-300 font-semibold">Construcciones</h3>
              {!canAct && (
                <p className="text-slate-400 text-sm">⏳ Es el turno de <span className="font-bold text-amber-300">{cur.name}</span>. Solo quien tiene el turno construye.</p>
              )}
              {Object.entries(COSTS)
                .filter(([type]) => mode.showDevCards || type !== "desarrollo")
                .map(([type, cost]) => {
                const canBuild = canAct && (mode.enforceCosts ? (afford(cur.hand, cost) && turnPhase === "rolled") : true);
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
                      className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${canBuild ? "bg-green-500 hover:bg-green-400 text-white" : "bg-slate-700 text-slate-500 cursor-not-allowed"}`}>
                      Construir
                    </button>
                  </div>
                );
              })}

              <div className="bg-slate-800/50 rounded-2xl p-4 mt-6">
                <h3 className="text-slate-300 font-semibold mb-3">{inRoomAsPlayer && !isMyTurn ? `Propiedades de ${cur.name}` : "Tus propiedades"}</h3>
                {getSettlementGroups(cur).length === 0 ? (
                  <p className="text-slate-500 text-sm">Sin propiedades registradas</p>
                ) : (
                  <div className="space-y-2">
                    {getSettlementGroups(cur).map((g, i) => (
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
                    <p className="text-slate-500 text-sm">No tenés suficientes recursos para comerciar con el banco.</p>
                  )}
                </div>
              </div>

              {/* Player trade */}
              <div className="bg-slate-800 rounded-2xl p-4">
                <h3 className="text-slate-300 font-semibold mb-3">Comercio entre jugadores</h3>
                <button onClick={() => { setTradeOther(cp === 0 ? 1 : 0); setTradeGive(eHand()); setTradeReceive(eHand()); setModal({ type: "playerTrade" }); }} disabled={turnPhase !== "rolled" || !canAct}
                  className={`w-full py-3 rounded-xl font-bold transition-all ${turnPhase === "rolled" && canAct ? "bg-blue-500 hover:bg-blue-400 text-white" : "bg-slate-700 text-slate-500 cursor-not-allowed"}`}>
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
                  {cur.ports.length === 0 && <span className="text-slate-500 text-sm">Sin puertos</span>}
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
            const canPlayNow = canAct && cardOwner === cur && turnPhase === "rolled";
            return (
              <div className="space-y-4">
                <div className="bg-slate-800 rounded-2xl p-4">
                  <h3 className="text-slate-300 font-semibold mb-2">
                    {inRoomAsPlayer ? `Tus cartas — ${cardOwner.name}` : "Tus cartas"} ({cardOwner.devCards.length})
                  </h3>
                  {cardOwner.devCards.length === 0 ? (
                    <p className="text-slate-500 text-sm">No tenés cartas de desarrollo</p>
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
                    <p className="text-slate-500 text-xs mt-2">⏳ Las cartas se juegan en tu turno, después de tirar los dados.</p>
                  )}
                </div>
                <p className="text-slate-500 text-sm text-center">Quedan {deck.length} cartas en el mazo</p>
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
                          className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded-lg">
                          + Poblado
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

                  {/* Resources */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {RES.map(r => (
                      <div key={r.id} className="flex items-center gap-1">
                        {canFix && (
                          <button onClick={() => manualAdjust(i, r.id, -1)}
                            className="w-5 h-5 bg-slate-700 hover:bg-red-700 text-slate-400 hover:text-white rounded text-xs flex items-center justify-center">−</button>
                        )}
                        <div className={`${r.bg} ${r.tx} px-2 py-0.5 rounded text-xs font-bold min-w-8 text-center`}>
                          {r.e}{p.hand[r.id]}
                        </div>
                        {canFix && (
                          <button onClick={() => manualAdjust(i, r.id, 1)}
                            className="w-5 h-5 bg-slate-700 hover:bg-green-700 text-slate-400 hover:text-white rounded text-xs flex items-center justify-center">+</button>
                        )}
                      </div>
                    ))}
                  </div>

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
                  <div className="flex gap-3 mt-2 text-xs text-slate-400">
                    <span>⚔️ {p.knightsPlayed}</span>
                    <span>🛤️ {p.roadsBuilt}</span>
                    <span>🃏 {p.devCards.length}</span>
                    {p.ports.length > 0 && <span>⚓ {p.ports.map(pt => pt === "3:1" ? "3:1" : RM[pt]?.e).join(" ")}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── LOG ── */}
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
                            className={`w-full py-2.5 px-3 rounded-xl flex items-center gap-3 text-sm font-semibold transition-all ${isMine ? "bg-blue-500/25 ring-1 ring-blue-400 text-white" : taken ? "bg-slate-700/50 text-slate-500 cursor-not-allowed" : "bg-slate-700 hover:bg-slate-600 text-white"}`}>
                            <span className="w-4 h-4 rounded-full" style={{backgroundColor: COLORS[p.ci].h}} />
                            <span>{p.name}</span>
                            {isMine && <span className="ml-auto text-blue-300 text-xs">✓ vos</span>}
                            {taken && <span className="ml-auto text-slate-500 text-xs">ocupado</span>}
                          </button>
                        );
                      })}
                    </div>

                    <p className="text-slate-500 text-xs mb-4">
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
                      className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-white rounded-xl font-bold">
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
                        if (type === "camino" || type === "desarrollo") {
                          doBuild(type);
                          setModal(null);
                        } else {
                          setModal(null);
                          doBuild(type);
                        }
                      }}
                      className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-white rounded-xl font-bold"
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              );
            })()}

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
                      } else {
                        setModal({ type: "robber" });
                      }
                    }}
                    className={`w-full py-3 rounded-xl font-bold ${discarded === mustDiscard ? "bg-red-500 hover:bg-red-400 text-white" : "bg-slate-700 text-slate-500 cursor-not-allowed"}`}>
                    Descartar
                  </button>
                </div>
              );
            })()}

            {/* Robber placement */}
            {modal.type === "robber" && (
              <div>
                <h3 className="text-xl font-bold text-red-400 mb-2">🦹 Colocar el ladrón</h3>
                <p className="text-slate-300 text-sm mb-4">Elegí en qué número colocar el ladrón para bloquear la producción.</p>
                <div className="grid grid-cols-5 gap-2 mb-4">
                  {NUMS.map(n => (
                    <button key={n} onClick={() => placeRobber(n)}
                      className={`py-3 rounded-xl font-bold text-lg transition-all ${n === robber ? "bg-red-600 text-white" : "bg-slate-700 hover:bg-slate-600 text-white"}`}>
                      {n}
                    </button>
                  ))}
                </div>
                <button onClick={() => { setModal(null); }} className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-sm">
                  Saltar (sin ladrón)
                </button>
              </div>
            )}

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
                  <h3 className="text-xl font-bold text-green-400 mb-2">🏠 Nuevo poblado</h3>
                  <p className="text-slate-300 text-sm mb-4">
                    {modal.type === "freeSettlement" ? `Para ${players[targetIdx].name}. ` : ""}
                    Agregá los hexágonos adyacentes (1-3).
                  </p>
                  <div className="space-y-2 mb-4">
                    {modalHexes.map((h, i) => (
                      <div key={i} className="flex gap-2">
                        <select value={h.num} onChange={e => { const nh = [...modalHexes]; nh[i] = { ...nh[i], num: e.target.value }; setModalHexes(nh); }}
                          className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600">
                          <option value="">Nro</option>
                          {NUMS.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <select value={h.res} onChange={e => { const nh = [...modalHexes]; nh[i] = { ...nh[i], res: e.target.value }; setModalHexes(nh); }}
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
                        if (modal.type === "freeSettlement") addFreeProductions(targetIdx, modalHexes);
                        else addSettlement(modalHexes);
                      }}
                      className="flex-1 py-3 bg-green-500 hover:bg-green-400 text-white rounded-xl font-bold disabled:opacity-30">
                      Confirmar
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Upgrade to city */}
            {modal.type === "upgradeCity" && (() => {
              const groups = getSettlementGroups(cur).filter(g => !g.isCity);
              return (
                <div>
                  <h3 className="text-xl font-bold text-amber-400 mb-2">🏙️ Mejorar a ciudad</h3>
                  <p className="text-slate-300 text-sm mb-4">Elegí qué poblado mejorar. Producirá el doble.</p>
                  {groups.length === 0 ? (
                    <p className="text-slate-500">No tenés poblados para mejorar.</p>
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
