import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { db } from './firebase';
import { ref, set, get, onValue, off } from 'firebase/database';

const STYLE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Nunito:wght@400;600;700;800&display=swap');

:root{
  --wood:#8B4513; --brick:#C0392B; --wheat:#F4D03F; --sheep:#27AE60; --ore:#7F8C8D;
  --bg:#1a0f0a; --bg2:#2c1810; --bg3:#3d2317;
  --gold:#d4a853; --gold-light:#f0d48a;
  --text:#f0e6d3; --text-dim:#a89278;
  --card-bg:rgba(44,24,16,.85);
  --danger:#e74c3c; --success:#2ecc71;
}

.catan-app{
  min-height:100vh;
  background:linear-gradient(to bottom, #78350f, #92400e, #713f12);
  color:var(--text);
  font-family:'Nunito',system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial;
  position:relative;
}

.catan-app::before{
  content:'';
  position:fixed;
  inset:0;
  background:
    radial-gradient(ellipse at 20% 20%, rgba(212,168,83,0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 80%, rgba(139,69,19,0.10) 0%, transparent 50%),
    url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 0L60 17.32v34.64L30 60 0 51.96V17.32z' fill='none' stroke='rgba(212,168,83,0.04)' stroke-width='1'/%3E%3C/svg%3E");
  pointer-events:none;
  z-index:0;
}

.catan-container{
  max-width: 980px;
  margin: 0 auto;
  padding: 16px;
  position:relative;
  z-index:1;
}

.center-screen{
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
}

.catan-title{
  font-family:'Cinzel',serif;
  letter-spacing:4px;
  color:var(--gold);
  text-shadow:0 2px 20px rgba(212,168,83,.25);
}

.panel{
  background:var(--card-bg);
  border:1px solid rgba(212,168,83,.15);
  border-radius:16px;
  padding:18px;
  backdrop-filter: blur(10px);
}

.panel-title{
  font-family:'Cinzel',serif;
  color:var(--gold);
  display:flex;
  align-items:center;
  gap:10px;
}

.btn{
  font-weight:800;
  border:none;
  border-radius:12px;
  padding:12px 18px;
  cursor:pointer;
  transition:all .2s;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:8px;
}

.btn:active{ transform:scale(.97); }

.btn-primary{
  background:linear-gradient(135deg,var(--gold),#b8902e);
  color:#fff;
  border:1px solid rgba(240,212,138,.55);
  box-shadow:0 10px 30px rgba(212,168,83,.30);
  font-size:1.15rem;
  padding:16px 32px;
  text-shadow:0 1px 3px rgba(0,0,0,.4);
}


.btn-secondary{
  background:var(--bg3);
  color:var(--gold);
  border:1px solid rgba(212,168,83,.30);
}

.die{
  width:72px; height:72px;
  background:linear-gradient(145deg,#faf3e6,#e8dcc8);
  border-radius:16px;
  display:flex; align-items:center; justify-content:center;
  font-family:'Cinzel',serif;
  font-size:2rem; font-weight:900;
  color:var(--bg);
  box-shadow:0 6px 20px rgba(0,0,0,.4), inset 0 2px 4px rgba(255,255,255,.3);
}

.distribution-item{
  display:flex;
  align-items:center;
  gap:10px;
  padding:10px 12px;
  border-radius:12px;
  background:rgba(46,204,113,.14);
  border:1px solid rgba(46,204,113,.18);
  border-left:3px solid var(--success);
  color:var(--text);
}


.log-entry{
  font-size:.85rem;
  padding:8px 10px;
  border-bottom:1px solid rgba(212,168,83,.06);
  color:var(--text-dim);
}

.log-entry b{ color:var(--gold); font-weight:800; }

.roll-status{color:rgba(240,230,211,.82);} 

.quick-nav{
  width:100%;
  padding:18px 16px;
  border-radius:16px;
  background:rgba(0,0,0,.08);
  border:2px solid rgba(240,212,138,.55);
  color:var(--text);
  font-weight:900;
  font-size:18px;
  letter-spacing:.2px;
  transition:all .15s ease;
}
.quick-nav:hover{
  background:rgba(212,168,83,.12);
  border-color:rgba(240,212,138,.85);
}


/* --- Contrast & no-tailwind critical UI --- */
.dice-sum{
  font-size:44px;
  font-weight:900;
  color:var(--gold-light);
  text-shadow:0 2px 18px rgba(212,168,83,.25);
  margin-top:6px;
}

.die-unknown{
  width:72px;
  height:72px;
  border-radius:16px;
  display:flex;
  align-items:center;
  justify-content:center;
  background:rgba(255,255,255,.10);
  border:1px solid rgba(240,212,138,.25);
  color:rgba(240,230,211,.85);
  font-size:30px;
  font-weight:900;
}

.quick-actions{
  width:100%;
  max-width:720px;
  margin:18px auto 0;
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:12px;
}

.roll-status{
  color:rgba(240,230,211,.92);
  font-weight:700;
  letter-spacing:.2px;
}

.btn-primary{
  box-shadow:0 14px 34px rgba(212,168,83,.35);
}

.quick-nav{
  background:rgba(240,212,138,.16);
  border:2px solid rgba(240,212,138,.85);
  color:var(--text);
  box-shadow:0 10px 26px rgba(0,0,0,.35);
}

.quick-nav:hover{
  background:rgba(240,212,138,.24);
}
`;


// ═══════════════════════════════════════════════
//  CONSTANTES
// ═══════════════════════════════════════════════
const RES = [
  { id: "madera", n: "Madera", e: "🌲", bg: "bg-green-700", tx: "text-green-100" },
  { id: "ladrillo", n: "Ladrillo", e: "🧱", bg: "bg-red-700", tx: "text-red-100" },
  { id: "trigo", n: "Trigo", e: "🌾", bg: "bg-yellow-600", tx: "text-yellow-100" },
  { id: "oveja", n: "Oveja", e: "🐑", bg: "bg-lime-600", tx: "text-lime-100" },
  { id: "mineral", n: "Mineral", e: "⛰️", bg: "bg-stone-600", tx: "text-stone-100" },
];
const RM = Object.fromEntries(RES.map(r => [r.id, r]));
const NUMS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
const COSTS = {
  camino: { madera: 1, ladrillo: 1 },
  poblado: { madera: 1, ladrillo: 1, trigo: 1, oveja: 1 },
  ciudad: { mineral: 3, trigo: 2 },
  desarrollo: { mineral: 1, trigo: 1, oveja: 1 },
};
const COST_NAMES = { camino: "Camino", poblado: "Poblado", ciudad: "Ciudad", desarrollo: "Carta Desarrollo" };
const COST_EMOJI = { camino: "🛤️", poblado: "🏠", ciudad: "🏙️", desarrollo: "🃏" };

const INIT_DECK = [
  ...Array(14).fill("caballero"), ...Array(5).fill("victoria"),
  ...Array(2).fill("caminos"), ...Array(2).fill("abundancia"), ...Array(2).fill("monopolio"),
];
const DC = {
  caballero: { n: "Caballero", e: "⚔️", d: "Mové el ladrón y robá 1 carta" },
  victoria: { n: "Punto de Victoria", e: "🏆", d: "+1 punto de victoria" },
  caminos: { n: "Construcción", e: "🛤️", d: "Construí 2 caminos gratis" },
  abundancia: { n: "Abundancia", e: "🎁", d: "Tomá 2 recursos del banco" },
  monopolio: { n: "Monopolio", e: "👑", d: "Todos te dan un recurso" },
};
const COLORS = [
  { n: "Azul", h: "#3b82f6", ring: "ring-blue-400" },
  { n: "Rojo", h: "#ef4444", ring: "ring-red-400" },
  { n: "Blanco", h: "#e2e8f0", ring: "ring-slate-300" },
  { n: "Naranja", h: "#f97316", ring: "ring-orange-400" },
  { n: "Verde", h: "#22c55e", ring: "ring-green-400" },
  { n: "Violeta", h: "#a855f7", ring: "ring-purple-400" },
];

const COLOR_EMOJI = ["🔵","🔴","⚪","🟠","🟢","🟣"];
const playerMark = (ci) => COLOR_EMOJI[ci] || "🔘";

// ═══════════════════════════════════════════════
//  MULTIPLAYER
// ═══════════════════════════════════════════════
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const genCode = () => Array.from({length:4}, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const getOrCreateId = () => {
  let id = localStorage.getItem('catan-pid');
  if (!id) { id = Math.random().toString(36).slice(2,10); localStorage.setItem('catan-pid', id); }
  return id;
};
const fixPlayer = (p) => ({
  ...p,
  productions: p.productions || [],
  hand: p.hand || { madera:0, ladrillo:0, trigo:0, oveja:0, mineral:0 },
  devCards: p.devCards || [],
  ports: p.ports || [],
  devCardBought: p.devCardBought || [],
});

// ═══════════════════════════════════════════════
//  UTILIDADES
// ═══════════════════════════════════════════════
const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const rollDie = () => Math.floor(Math.random() * 6) + 1;
const afford = (h, c) => Object.entries(c).every(([r, a]) => (h[r] || 0) >= a);
const totalC = h => Object.values(h).reduce((a, b) => a + b, 0);
const eHand = () => ({ madera: 0, ladrillo: 0, trigo: 0, oveja: 0, mineral: 0 });
let _id = Date.now();
const gid = () => _id++;

const numberProb = n => { const d = Math.abs(7 - n); return 6 - d; };
const dotStr = n => "•".repeat(numberProb(n));

// Dice face SVG
const DiceFace = ({ value, rolling }) => {
  const dots = {
    1: [[50,50]], 2: [[25,25],[75,75]], 3: [[25,25],[50,50],[75,75]],
    4: [[25,25],[75,25],[25,75],[75,75]], 5: [[25,25],[75,25],[50,50],[25,75],[75,75]],
    6: [[25,20],[75,20],[25,50],[75,50],[25,80],[75,80]],
  };
  return (
    <div className={`w-16 h-16 bg-white rounded-xl shadow-lg flex items-center justify-center ${rolling ? "animate-bounce" : ""}`}>
      <svg viewBox="0 0 100 100" className="w-12 h-12">
        {(dots[value] || []).map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={10} fill="#1e293b" />
        ))}
      </svg>
    </div>
  );
};

// Resource badge
const ResBadge = ({ id, count, small }) => {
  const r = RM[id];
  if (!r) return null;
  return (
    <span className={`inline-flex items-center gap-1 ${r.bg} ${r.tx} ${small ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-sm"} rounded-full font-medium`}>
      {r.e} {count !== undefined && <span>{count}</span>}
    </span>
  );
};

// ═══════════════════════════════════════════════
//  APP PRINCIPAL
// ═══════════════════════════════════════════════
export default function CatanApp() {
  const [phase, setPhase] = useState("lobby");
  const [pCount, setPCount] = useState(3);
  const [players, setPlayers] = useState([]);
  const [cp, setCp] = useState(0); // current player
  const [turnPhase, setTurnPhase] = useState("preroll");
  const [dice, setDice] = useState([0, 0]);
  const [deck, setDeck] = useState([]);
  const [robber, setRobber] = useState(null); // blocked number
  const [log, setLog] = useState([]);
  const [notif, setNotif] = useState(null);
  const [tab, setTab] = useState("dados");
  const [turn, setTurn] = useState(1);
  const [rolling, setRolling] = useState(false);
  const [modal, setModal] = useState(null);
  const [winner, setWinner] = useState(null);
  const [diceHistory, setDiceHistory] = useState([]);
  const [lastDistribution, setLastDistribution] = useState(null);
  const [setupIdx, setSetupIdx] = useState(0);
  const [setupData, setSetupData] = useState({});
  // Modal-level state
  const [modalDiscards, setModalDiscards] = useState(eHand());
  const [modalHexes, setModalHexes] = useState([{ num: "", res: "" }]);
  const [tradeOther, setTradeOther] = useState(0);
  const [tradeGive, setTradeGive] = useState(eHand());
  const [tradeReceive, setTradeReceive] = useState(eHand());
  const notifTimer = useRef(null);

  // ── MULTIPLAYER STATE ──
  const [mode, setMode] = useState(null); // null | 'local' | 'online'
  const [gameId, setGameId] = useState(null);
  const [playerId] = useState(getOrCreateId);
  const [isHost, setIsHost] = useState(false);
  const [lobbyPlayers, setLobbyPlayers] = useState({});
  const [myPlayerIndex, setMyPlayerIndex] = useState(-1);
  const [joinCode, setJoinCode] = useState('');
  const [lobbyName, setLobbyName] = useState('');
  const skipSync = useRef(0);

  const addLog = useCallback((msg) => setLog(l => [{ t: Date.now(), m: msg }, ...l].slice(0, 100)), []);

  const showNotif = useCallback((msg, dur = 3000) => {
    setNotif(msg);
    if (notifTimer.current) clearTimeout(notifTimer.current);
    notifTimer.current = setTimeout(() => setNotif(null), dur);
  }, []);

  // ═══════════════════════════════════════════════
  //  FIREBASE SYNC
  // ═══════════════════════════════════════════════
  const isOnline = mode === 'online' && !!gameId && !!db;
  const isMyTurn = mode !== 'online' || myPlayerIndex === cp;

  // Auto-detect ?game=XXXX in URL
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('game');
    if (code) setJoinCode(code.toUpperCase());
  }, []);

  // Lobby listener
  useEffect(() => {
    if (!isOnline || phase !== 'lobby') return;
    const lobbyRef = ref(db, `games/${gameId}/lobby`);
    const unsub = onValue(lobbyRef, snap => setLobbyPlayers(snap.val() || {}));
    return () => off(lobbyRef);
  }, [isOnline, gameId, phase]);

  // Game state → Firebase (write)
  useEffect(() => {
    if (!isOnline || phase === 'lobby') return;
    if (skipSync.current > 0) { skipSync.current--; return; }
    const state = {
      phase, pCount, players, cp, turnPhase, dice, deck, robber,
      log: log.slice(0, 50), turn, diceHistory, lastDistribution,
      setupIdx, setupData, _w: playerId
    };
    set(ref(db, `games/${gameId}/state`), state).catch(() => {});
  }, [phase, pCount, players, cp, turnPhase, dice, deck, robber, log, turn, diceHistory, lastDistribution, setupIdx, setupData]);

  // Firebase → Game state (read)
  useEffect(() => {
    if (!isOnline) return;
    const stateRef = ref(db, `games/${gameId}/state`);
    const unsub = onValue(stateRef, snap => {
      const d = snap.val();
      if (!d || d._w === playerId) return;
      skipSync.current = 1;
      if (d.phase) setPhase(d.phase);
      if (d.pCount) setPCount(d.pCount);
      if (d.players) setPlayers(d.players.map(fixPlayer));
      if (d.cp !== undefined) setCp(d.cp);
      if (d.turnPhase) setTurnPhase(d.turnPhase);
      if (d.dice) setDice(d.dice);
      setDeck(d.deck || []);
      setRobber(d.robber ?? null);
      if (d.log) setLog(d.log);
      if (d.turn) setTurn(d.turn);
      setDiceHistory(d.diceHistory || []);
      setLastDistribution(d.lastDistribution ?? null);
      if (d.setupIdx !== undefined) setSetupIdx(d.setupIdx);
      if (d.setupData) setSetupData(d.setupData);
    });
    return () => off(stateRef);
  }, [isOnline, gameId, playerId]);

  // ═══════════════════════════════════════════════
  //  LOBBY HANDLERS
  // ═══════════════════════════════════════════════
  const createGame = async () => {
    if (!db) { showNotif('Firebase no configurado. Editá firebase.js'); return; }
    const code = genCode();
    const name = lobbyName.trim() || 'Host';
    await set(ref(db, `games/${code}`), {
      host: playerId, createdAt: Date.now(),
      lobby: { [playerId]: { name, ci: 0, order: 0 } }
    });
    setGameId(code);
    setIsHost(true);
    setMode('online');
    setMyPlayerIndex(0);
    setLobbyPlayers({ [playerId]: { name, ci: 0, order: 0 } });
  };

  const joinGame = async () => {
    if (!db) { showNotif('Firebase no configurado'); return; }
    const code = joinCode.toUpperCase().trim();
    if (code.length !== 4) { showNotif('El código debe tener 4 letras'); return; }
    const snap = await get(ref(db, `games/${code}`));
    if (!snap.exists()) { showNotif('Partida no encontrada'); return; }
    const game = snap.val();
    if (game.state && game.state.phase && game.state.phase !== 'lobby') {
      showNotif('La partida ya empezó'); return;
    }
    const entries = Object.entries(game.lobby || {});
    const order = entries.length;
    const usedColors = entries.map(([,v]) => v.ci);
    const freeColor = [0,1,2,3,4,5].find(c => !usedColors.includes(c)) ?? 0;
    const name = lobbyName.trim() || `Jugador ${order + 1}`;
    await set(ref(db, `games/${code}/lobby/${playerId}`), { name, ci: freeColor, order });
    setGameId(code);
    setIsHost(false);
    setMode('online');
    setMyPlayerIndex(order);
    showNotif(`Te uniste a la partida ${code}`);
  };

  const startOnlineGame = () => {
    const entries = Object.entries(lobbyPlayers).sort(([,a],[,b]) => a.order - b.order);
    if (entries.length < 2) { showNotif('Se necesitan al menos 2 jugadores'); return; }
    const newPlayers = entries.map(([, lp]) => ({
      name: lp.name, ci: lp.ci, productions: [], hand: eHand(),
      devCards: [], knightsPlayed: 0, roadsBuilt: 0,
      ports: [], devCardBought: [], devCardPlayed: false,
    }));
    const count = newPlayers.length;
    setPlayers(newPlayers);
    setPCount(count);
    const sd = {};
    for (let i = 0; i < count; i++) sd[i] = [{ hexes: [{ num: "", res: "" }] }, { hexes: [{ num: "", res: "" }] }];
    setSetupData(sd);
    setSetupIdx(0);
    const myEntry = entries.findIndex(([id]) => id === playerId);
    setMyPlayerIndex(myEntry >= 0 ? myEntry : 0);
    setPhase("settlements");
  };

  const startLocal = () => {
    setMode('local');
    setPhase('count');
  };

  // ── SCORES ──
  const scores = useMemo(() => players.map(p => {
    const grp = {};
    p.productions.forEach(pr => {
      if (!grp[pr.gid]) grp[pr.gid] = false;
      if (pr.isCity) grp[pr.gid] = true;
    });
    const sett = Object.values(grp).filter(c => !c).length;
    const cit = Object.values(grp).filter(c => c).length;
    return sett + cit * 2 + p.devCards.filter(c => c === "victoria").length;
  }), [players]);

  const largestArmy = useMemo(() => {
    let best = -1, who = null;
    players.forEach((p, i) => { if (p.knightsPlayed >= 3 && p.knightsPlayed > best) { best = p.knightsPlayed; who = i; } });
    return who;
  }, [players]);

  const longestRoad = useMemo(() => {
    let best = -1, who = null;
    players.forEach((p, i) => { if (p.roadsBuilt >= 5 && p.roadsBuilt > best) { best = p.roadsBuilt; who = i; } });
    return who;
  }, [players]);

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
    const w = finalScores.findIndex(s => s >= 10);
    if (w >= 0 && !winner) setWinner(w);
  }, [finalScores, winner]);

  // ── SETUP HANDLERS ──
  const initPlayers = () => {
    const names = [];
    for (let i = 0; i < pCount; i++) names.push(`Jugador ${i + 1}`);
    setPlayers(names.map((n, i) => ({
      name: n, ci: i, productions: [], hand: eHand(),
      devCards: [], knightsPlayed: 0, roadsBuilt: 0,
      ports: [], devCardBought: [], devCardPlayed: false,
    })));
    const sd = {};
    for (let i = 0; i < pCount; i++) sd[i] = [{ hexes: [{ num: "", res: "" }] }, { hexes: [{ num: "", res: "" }] }];
    setSetupData(sd);
    setPhase("names");
  };

  const startGame = () => {
    setPlayers(prev => prev.map((p, pi) => {
      const prods = [];
      (setupData[pi] || []).forEach((sett, si) => {
        const gidVal = gid();
        sett.hexes.forEach(h => {
          if (h.num && h.res) prods.push({ id: gid(), num: parseInt(h.num), res: h.res, isCity: false, gid: gidVal });
        });
      });
      return { ...p, productions: prods };
    }));
    setDeck(shuffle([...INIT_DECK]));
    const first = Math.floor(Math.random() * pCount);
    setCp(first);
    addLog(`🎲 Empieza ${players[first]?.name || "Jugador " + (first + 1)}. ¡A jugar!`);
    setPhase("game");
  };

  // ── GAME HANDLERS ──
  const doRollDice = () => {
    setRolling(true);
    const d1 = rollDie(), d2 = rollDie();
    setTimeout(() => {
      setDice([d1, d2]);
      setRolling(false);
      const sum = d1 + d2;
      setDiceHistory(prev => [sum, ...prev].slice(0, 24));
      addLog(`🎲 ${players[cp].name} tiró ${d1} + ${d2} = ${sum}`);

      if (sum === 7) {
        // Check who needs to discard
        const needDiscard = players.map((p, i) => ({ idx: i, total: totalC(p.hand) })).filter(x => x.total > 7);
        if (needDiscard.length > 0) {
          setModalDiscards(eHand());
          setModal({ type: "discard", queue: needDiscard.map(x => x.idx), current: 0 });
        } else {
          setModal({ type: "robber" });
        }
        setTurnPhase("rolled");
      } else {
        // Distribute resources
        distributeResources(sum);
        setTurnPhase("rolled");
      }
    }, 600);
  };

  const distributeResources = (num) => {
    // Build distribution lines based on current productions
    if (num === robber) {
      const msg = `⛔ El ladrón bloquea el ${num}. Nadie recibe recursos.`;
      showNotif(msg);
      addLog(`⛔ Ladrón bloquea el ${num}`);
      setLastDistribution({ num, lines: [] });
      return;
    }

    const lines = [];
    const gainsByPlayer = players.map(p => {
      const gains = eHand();
      p.productions.forEach(pr => {
        if (pr.num === num && pr.num !== robber) {
          const amt = pr.isCity ? 2 : 1;
          gains[pr.res] = (gains[pr.res] || 0) + amt;
        }
      });
      return gains;
    });

    // Apply gains to hands
    setPlayers(prev => prev.map((p, i) => {
      const gains = gainsByPlayer[i] || eHand();
      const newHand = { ...p.hand };
      Object.entries(gains).forEach(([r, v]) => { newHand[r] += v; });
      return { ...p, hand: newHand };
    }));

    // Build UX lines + logs
    gainsByPlayer.forEach((gains, i) => {
      const items = Object.entries(gains)
        .filter(([, v]) => v > 0)
        .map(([r, v]) => `+${v} ${RM[r].e} ${RM[r].n}`)
        .join(" ");
      if (items) {
        lines.push({ ci: players[i].ci, name: players[i].name, items });
        addLog(`📦 ${players[i].name}: ${items}`);
      }
    });

    setLastDistribution({ num, lines });

    if (lines.length > 0) {
      // Keep the notification short; detailed list is shown in the panel
      showNotif(`📦 Recursos distribuidos (${lines.length} jugador${lines.length === 1 ? "" : "es"})`, 2500);
    } else {
      showNotif(`Nadie produce con el ${num}`);
      addLog(`📦 Nadie produce con el ${num}`);
    }
  };

  const applyDiscard = (playerIdx, discards) => {
    setPlayers(prev => prev.map((p, i) => {
      if (i !== playerIdx) return p;
      const nh = { ...p.hand };
      Object.entries(discards).forEach(([r, v]) => { nh[r] -= v; });
      return { ...p, hand: nh };
    }));
    const items = Object.entries(discards).filter(([, v]) => v > 0).map(([r, v]) => `${v}${RM[r].e}`).join(" ");
    addLog(`🗑️ ${players[playerIdx].name} descartó ${items}`);
  };

  const placeRobber = (num) => {
    setRobber(num);
    addLog(`🦹 Ladrón colocado en el ${num}`);
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
    setPlayers(prev => prev.map((p, i) => {
      if (i === victimIdx) { const nh = { ...p.hand }; nh[stolen]--; return { ...p, hand: nh }; }
      if (i === cp) { const nh = { ...p.hand }; nh[stolen]++; return { ...p, hand: nh }; }
      return p;
    }));
    addLog(`🦹 ${players[cp].name} robó 1${RM[stolen].e} a ${victim.name}`);
    showNotif(`Robaste ${RM[stolen].e} ${RM[stolen].n} a ${victim.name}`);
    setModal(null);
  };

  // Freemium MVP: construir con confirmación + error claro
  const requestBuild = (type) => {
    if (turnPhase !== "rolled") {
      showNotif("Primero tirá los dados (y esperá a que se distribuyan recursos)");
      return;
    }
    const cost = COSTS[type];
    if (!afford(players[cp].hand, cost)) {
      showNotif("No se puede: te faltan recursos");
      return;
    }
    setModal({ type: "confirmBuild", buildType: type });
  };

  const doBuild = (type) => {
    const cost = COSTS[type];
    if (!afford(players[cp].hand, cost)) { showNotif("No tenés suficientes recursos"); return; }

    if (type === "camino") {
      setPlayers(prev => prev.map((p, i) => {
        if (i !== cp) return p;
        const nh = { ...p.hand };
        Object.entries(cost).forEach(([r, v]) => { nh[r] -= v; });
        return { ...p, hand: nh, roadsBuilt: p.roadsBuilt + 1 };
      }));
      addLog(`🛤️ ${players[cp].name} construyó un camino (total: ${players[cp].roadsBuilt + 1})`);
      showNotif("Camino construido");
    } else if (type === "poblado") {
      setModalHexes([{ num: "", res: "" }]);
      setModal({ type: "newSettlement", building: "poblado" });
    } else if (type === "ciudad") {
      setModal({ type: "upgradeCity" });
    } else if (type === "desarrollo") {
      if (deck.length === 0) { showNotif("No quedan cartas de desarrollo"); return; }
      setPlayers(prev => prev.map((p, i) => {
        if (i !== cp) return p;
        const nh = { ...p.hand };
        Object.entries(cost).forEach(([r, v]) => { nh[r] -= v; });
        const card = deck[0];
        return { ...p, hand: nh, devCards: [...p.devCards, card], devCardBought: [...p.devCardBought, card] };
      }));
      const card = deck[0];
      setDeck(prev => prev.slice(1));
      addLog(`🃏 ${players[cp].name} compró carta de desarrollo`);
      showNotif(`Compraste: ${DC[card].e} ${DC[card].n}`);
    }
  };

  const addSettlement = (hexes) => {
    const gidVal = gid();
    setPlayers(prev => prev.map((p, i) => {
      if (i !== cp) return p;
      const nh = { ...p.hand };
      Object.entries(COSTS.poblado).forEach(([r, v]) => { nh[r] -= v; });
      const newProds = hexes.filter(h => h.num && h.res).map(h => ({
        id: gid(), num: parseInt(h.num), res: h.res, isCity: false, gid: gidVal,
      }));
      return { ...p, hand: nh, productions: [...p.productions, ...newProds] };
    }));
    addLog(`🏠 ${players[cp].name} construyó un poblado`);
    showNotif("Poblado construido");
    setModal(null);
  };

  const upgradeToCity = (gidVal) => {
    setPlayers(prev => prev.map((p, i) => {
      if (i !== cp) return p;
      const nh = { ...p.hand };
      Object.entries(COSTS.ciudad).forEach(([r, v]) => { nh[r] -= v; });
      return {
        ...p, hand: nh,
        productions: p.productions.map(pr => pr.gid === gidVal ? { ...pr, isCity: true } : pr),
      };
    }));
    addLog(`🏙️ ${players[cp].name} mejoró a ciudad`);
    showNotif("Ciudad construida");
    setModal(null);
  };

  const doTrade = (give, receive, ratio) => {
    setPlayers(prev => prev.map((p, i) => {
      if (i !== cp) return p;
      const nh = { ...p.hand };
      nh[give] -= ratio;
      nh[receive] += 1;
      return { ...p, hand: nh };
    }));
    addLog(`🔄 ${players[cp].name} cambió ${ratio}${RM[give].e} por 1${RM[receive].e}`);
    showNotif(`Cambiaste ${ratio} ${RM[give].n} por 1 ${RM[receive].n}`);
  };

  const doPlayerTrade = (otherIdx, give, receive) => {
    setPlayers(prev => prev.map((p, i) => {
      if (i === cp) {
        const nh = { ...p.hand };
        Object.entries(give).forEach(([r, v]) => { nh[r] -= v; });
        Object.entries(receive).forEach(([r, v]) => { nh[r] += v; });
        return { ...p, hand: nh };
      }
      if (i === otherIdx) {
        const nh = { ...p.hand };
        Object.entries(give).forEach(([r, v]) => { nh[r] += v; });
        Object.entries(receive).forEach(([r, v]) => { nh[r] -= v; });
        return { ...p, hand: nh };
      }
      return p;
    }));
    addLog(`🤝 ${players[cp].name} comerció con ${players[otherIdx].name}`);
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

    if (cardType === "caballero") {
      setPlayers(prev => prev.map((p, i) => {
        if (i !== cp) return p;
        const dc = [...p.devCards]; dc.splice(cardIdx, 1);
        return { ...p, devCards: dc, knightsPlayed: p.knightsPlayed + 1, devCardPlayed: true };
      }));
      addLog(`⚔️ ${players[cp].name} jugó Caballero (total: ${players[cp].knightsPlayed + 1})`);
      setModal({ type: "robber" });
    } else if (cardType === "monopolio") {
      setPlayers(prev => prev.map((p, i) => {
        if (i !== cp) return p;
        const dc = [...p.devCards]; dc.splice(cardIdx, 1);
        return { ...p, devCards: dc, devCardPlayed: true };
      }));
      setModal({ type: "monopoly" });
    } else if (cardType === "abundancia") {
      setPlayers(prev => prev.map((p, i) => {
        if (i !== cp) return p;
        const dc = [...p.devCards]; dc.splice(cardIdx, 1);
        return { ...p, devCards: dc, devCardPlayed: true };
      }));
      setModal({ type: "yearOfPlenty", picks: 0 });
    } else if (cardType === "caminos") {
      setPlayers(prev => prev.map((p, i) => {
        if (i !== cp) return p;
        const dc = [...p.devCards]; dc.splice(cardIdx, 1);
        return { ...p, devCards: dc, roadsBuilt: p.roadsBuilt + 2, devCardPlayed: true };
      }));
      addLog(`🛤️ ${players[cp].name} jugó Construcción (+2 caminos, total: ${players[cp].roadsBuilt + 2})`);
      showNotif("Construcción: +2 caminos");
    }
  };

  const applyMonopoly = (res) => {
    let stolen = 0;
    setPlayers(prev => {
      const updated = prev.map(p => ({ ...p }));
      prev.forEach((p, i) => {
        if (i === cp) return;
        stolen += p.hand[res];
        updated[i] = { ...updated[i], hand: { ...p.hand, [res]: 0 } };
      });
      updated[cp] = { ...updated[cp], hand: { ...updated[cp].hand, [res]: updated[cp].hand[res] + stolen } };
      return updated;
    });
    addLog(`👑 ${players[cp].name} jugó Monopolio (${RM[res].n}): robó ${stolen}`);
    showNotif(`Monopolio: robaste ${stolen} ${RM[res].n}`);
    setModal(null);
  };

  const applyYearOfPlenty = (res) => {
    setPlayers(prev => prev.map((p, i) => {
      if (i !== cp) return p;
      return { ...p, hand: { ...p.hand, [res]: p.hand[res] + 1 } };
    }));
    if (modal.picks >= 1) {
      addLog(`🎁 ${players[cp].name} jugó Abundancia`);
      showNotif("Abundancia: tomaste 2 recursos");
      setModal(null);
    } else {
      setModal(prev => ({ ...prev, picks: (prev?.picks || 0) + 1 }));
    }
  };

  const endTurn = () => {
    setPlayers(prev => prev.map((p, i) => i === cp ? { ...p, devCardBought: [], devCardPlayed: false } : p));
    const next = (cp + 1) % players.length;
    setCp(next);
    setTurnPhase("preroll");
    setDice([0, 0]);
    if (next === 0) setTurn(t => t + 1);
    setTab("dados");
    addLog(`➡️ Turno de ${players[next].name}`);
  };

  const getTradeRatio = (res) => {
    const p = players[cp];
    if (p.ports.includes(res)) return 2;
    if (p.ports.includes("3:1")) return 3;
    return 4;
  };

  const addPort = (port) => {
    setPlayers(prev => prev.map((p, i) => {
      if (i !== cp) return p;
      if (p.ports.includes(port)) return p;
      return { ...p, ports: [...p.ports, port] };
    }));
    showNotif(`Puerto ${port === "3:1" ? "3:1" : RM[port]?.n} agregado`);
  };

  const removePort = (port) => {
    setPlayers(prev => prev.map((p, i) => {
      if (i !== cp) return p;
      return { ...p, ports: p.ports.filter(pt => pt !== port) };
    }));
  };

  const addFreeSettlement = (playerIdx) => {
    setModalHexes([{ num: "", res: "" }]);
    setModal({ type: "freeSettlement", playerIdx });
  };

  const addFreeProductions = (playerIdx, hexes) => {
    const gidVal = gid();
    setPlayers(prev => prev.map((p, i) => {
      if (i !== playerIdx) return p;
      const newProds = hexes.filter(h => h.num && h.res).map(h => ({
        id: gid(), num: parseInt(h.num), res: h.res, isCity: false, gid: gidVal,
      }));
      return { ...p, productions: [...p.productions, ...newProds] };
    }));
    addLog(`🏠 Se agregó un poblado a ${players[playerIdx].name}`);
    showNotif("Poblado agregado");
    setModal(null);
  };

  const manualAdjust = (playerIdx, res, delta) => {
    setPlayers(prev => prev.map((p, i) => {
      if (i !== playerIdx) return p;
      const nh = { ...p.hand };
      nh[res] = Math.max(0, nh[res] + delta);
      return { ...p, hand: nh };
    }));
  };

  // ═══════════════════════════════════════════════
  //  RENDER: LOBBY (MULTIPLAYER)
  // ═══════════════════════════════════════════════
  if (phase === "lobby") return (
    <div className="catan-app">
      <style>{STYLE_CSS}</style>
      <div className="catan-container center-screen">
        {!mode ? (
          <div className="bg-slate-900/90 backdrop-blur rounded-3xl p-8 max-w-md w-full text-center shadow-2xl border border-amber-600/30">
            <div className="text-6xl mb-4">🏝️</div>
            <h1 className="catan-title text-4xl font-bold mb-2">CATÁN</h1>
            <p className="text-slate-400 mb-8">Companion App</p>
            <div className="mb-6">
              <input
                className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white focus:border-amber-500 focus:outline-none transition text-center"
                value={lobbyName} onChange={e => setLobbyName(e.target.value)}
                placeholder="Tu nombre" maxLength={20}
              />
            </div>
            {db ? (
              <div className="space-y-3">
                <button onClick={createGame}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-white font-bold rounded-xl text-lg transition-all shadow-lg shadow-amber-500/20">
                  Crear partida online
                </button>
                <div className="flex gap-2">
                  <input
                    className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white text-center uppercase tracking-widest font-bold focus:border-amber-500 focus:outline-none"
                    value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0,4))}
                    placeholder="CÓDIGO" maxLength={4}
                  />
                  <button onClick={joinGame} disabled={joinCode.length !== 4}
                    className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-bold rounded-xl transition-all disabled:opacity-30">
                    Unirse
                  </button>
                </div>
                <div className="border-t border-slate-700 pt-3 mt-3">
                  <button onClick={startLocal}
                    className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold rounded-xl transition-all">
                    Jugar local (sin internet)
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <button onClick={startLocal}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-white font-bold rounded-xl text-lg transition-all shadow-lg shadow-amber-500/20">
                  Jugar
                </button>
                <p className="text-slate-500 text-sm">Para multijugador online, configurá Firebase en src/firebase.js</p>
              </div>
            )}
          </div>
        ) : mode === 'online' && gameId ? (
          <div className="bg-slate-900/90 backdrop-blur rounded-3xl p-8 max-w-md w-full shadow-2xl border border-amber-600/30">
            <h2 className="text-2xl font-bold text-amber-400 mb-4 text-center">Sala de espera</h2>
            <div className="bg-slate-800 rounded-2xl p-4 mb-6 text-center">
              <p className="text-slate-400 text-sm mb-2">Código de partida</p>
              <div className="text-4xl font-bold text-white tracking-[.5em] font-mono">{gameId}</div>
              <button onClick={() => {
                const url = `${window.location.origin}${window.location.pathname}?game=${gameId}`;
                navigator.clipboard?.writeText(url).then(() => showNotif('Link copiado'));
              }} className="mt-3 text-sm text-amber-400 hover:text-amber-300">
                Copiar link de invitación
              </button>
            </div>
            <div className="space-y-2 mb-6">
              <p className="text-slate-400 text-sm">Jugadores conectados ({Object.keys(lobbyPlayers).length})</p>
              {Object.entries(lobbyPlayers).sort(([,a],[,b]) => a.order - b.order).map(([pid, lp]) => (
                <div key={pid} className="flex items-center gap-3 bg-slate-800 rounded-xl px-4 py-3">
                  <div className="w-8 h-8 rounded-full" style={{backgroundColor: COLORS[lp.ci]?.h || '#666'}} />
                  <span className="text-white font-medium flex-1">{lp.name}</span>
                  {pid === playerId && <span className="text-amber-400 text-xs font-bold">TÚ</span>}
                </div>
              ))}
            </div>
            {isHost && Object.keys(lobbyPlayers).length >= 2 ? (
              <button onClick={startOnlineGame}
                className="w-full py-3 bg-green-500 hover:bg-green-400 text-white font-bold rounded-xl text-lg transition-all">
                Empezar partida ({Object.keys(lobbyPlayers).length} jugadores)
              </button>
            ) : isHost ? (
              <p className="text-slate-500 text-center text-sm">Esperando jugadores... (mínimo 2)</p>
            ) : (
              <p className="text-slate-500 text-center text-sm">Esperando a que el host inicie la partida...</p>
            )}
          </div>
        ) : null}
      </div>
      {notif && (
        <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",zIndex:40,background:"#1e293b",border:"1px solid rgba(212,168,83,.5)",color:"#f0e6d3",padding:"12px 24px",borderRadius:16,boxShadow:"0 8px 32px rgba(0,0,0,.5)",fontSize:15,fontWeight:700,maxWidth:400,textAlign:"center"}}>
          {notif}
        </div>
      )}
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
        <p className="text-slate-400 mb-8">Companion App</p>
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
        <h2 className="text-2xl font-bold text-amber-400 mb-6 text-center">Nombres y colores</h2>
        <div className="space-y-3 mb-8">
          {players.map((p, i) => {
            const usedColors = players.map((pl, j) => j !== i ? pl.ci : -1).filter(c => c >= 0);
            const [open, setOpen] = [p._colorOpen || false, (v) => setPlayers(prev => prev.map((pl, j) => j === i ? { ...pl, _colorOpen: v } : pl))];
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
                            onClick={() => { setPlayers(prev => prev.map((pl, j) => j === i ? { ...pl, ci, _colorOpen: false } : pl)); }}
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
                    setPlayers(prev => prev.map((pl, j) => j === i ? { ...pl, name: v } : pl));
                  }}
                  placeholder={`Jugador ${i + 1}`}
                />
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
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style={{backgroundColor:COLORS[players[setupIdx]?.ci ?? setupIdx].h}}>
                {setupIdx + 1}
              </div>
              <div>
                <h2 className="text-xl font-bold text-amber-400">{players[setupIdx]?.name}</h2>
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
              {setupIdx < players.length - 1 ? (
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
              {players.map((_, i) => (
                <div key={i} className={`w-3 h-3 rounded-full transition-all ${i === setupIdx ? "scale-125" : ""}`} style={{backgroundColor: i === setupIdx ? COLORS[players[i]?.ci ?? i].h : "#475569"}} />
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
  if (phase !== "game") return null;
  const cur = players[cp];
  const diceSum = dice[0] + dice[1];

  const TABS = [
    { id: "dados", label: "Dados", e: "🎲" },
    { id: "construir", label: "Construir", e: "🏗️" },
    { id: "comerciar", label: "Comerciar", e: "🔄" },
    { id: "cartas", label: "Cartas", e: "🃏" },
    { id: "jugadores", label: "Jugadores", e: "👥" },
    { id: "log", label: "Log", e: "📋" },
  ];

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
            <button onClick={() => { setPhase("lobby"); setMode(null); setGameId(null); setWinner(null); setPlayers([]); setLog([]); setTurn(1); }}
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
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isOnline && <span className="text-xs bg-blue-900 text-blue-300 px-2 py-1 rounded-full">{gameId}</span>}
            {robber && <span className="text-xs bg-red-900 text-red-300 px-2 py-1 rounded-full">🦹 {robber}</span>}
            {turnPhase === "rolled" && isMyTurn && (
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
              <span className="text-slate-500 text-xs">({totalC(p.hand)}🃏)</span>
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
                {turnPhase === "preroll" && isMyTurn && (
                  <button onClick={doRollDice}
                    style={{background:"linear-gradient(135deg,#d4a853,#b8902e)",color:"#fff",fontFamily:"'Nunito',system-ui,sans-serif",fontWeight:800,fontSize:"1.15rem",padding:"16px 48px",borderRadius:12,border:"1px solid rgba(240,212,138,.55)",boxShadow:"0 14px 34px rgba(212,168,83,.35)",cursor:"pointer",textShadow:"0 1px 3px rgba(0,0,0,.4)",textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",gap:8,margin:"0 auto"}}>
                    🎲 Tirar dados
                  </button>
                )}
                {turnPhase === "preroll" && !isMyTurn && (
                  <p style={{color:"rgba(240,230,211,.6)",fontWeight:700,fontSize:15,textAlign:"center",margin:0}}>
                    Esperando a que {players[cp]?.name} tire los dados...
                  </p>
                )}
                {turnPhase === "rolled" && diceSum > 0 && diceSum !== 7 && (
                  <p style={{color:"#f0e6d3",fontWeight:700,fontSize:15,letterSpacing:".2px",textAlign:"center",margin:0}}>{(lastDistribution?.num === diceSum && lastDistribution?.lines?.length > 0) ? "Recursos distribuidos. Podés construir, comerciar o terminar turno." : "Ningún jugador recibe recursos."}</p>
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

                {turnPhase === "rolled" && diceSum > 0 && (
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

              </div>

              {/* Freemium: historial de números (tipo ruleta) */}
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

              {/* Current player hand */}
              <div className="bg-slate-800 rounded-2xl p-4">
                <h3 className="text-slate-300 font-semibold mb-3">Tu mano ({totalC(cur.hand)} cartas)</h3>
                <div className="flex flex-wrap gap-2">
                  {RES.map(r => (
                    <div key={r.id} className={`${r.bg} ${r.tx} px-3 py-2 rounded-xl flex items-center gap-2 font-bold`}>
                      <span>{r.e}</span>
                      <span className="text-lg">{cur.hand[r.id]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── CONSTRUIR ── */}
          {tab === "construir" && (
            <div className="space-y-4">
              <h3 className="text-slate-300 font-semibold">Construcciones</h3>
              {Object.entries(COSTS).map(([type, cost]) => {
                const canBuild = afford(cur.hand, cost) && turnPhase === "rolled" && isMyTurn;
                return (
                  <div key={type} className="bg-slate-800 rounded-2xl p-4 flex items-center justify-between">
                    <div>
                      <div className="text-white font-bold">{COST_EMOJI[type]} {COST_NAMES[type]}</div>
                      <div className="flex gap-1 mt-1">
                        {Object.entries(cost).map(([r, v]) => (
                          <ResBadge key={r} id={r} count={v} small />
                        ))}
                      </div>
                    </div>
                    <button onClick={() => requestBuild(type)} disabled={!canBuild}
                      className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${canBuild ? "bg-green-500 hover:bg-green-400 text-white" : "bg-slate-700 text-slate-500 cursor-not-allowed"}`}>
                      Construir
                    </button>
                  </div>
                );
              })}

              <div className="bg-slate-800/50 rounded-2xl p-4 mt-6">
                <h3 className="text-slate-300 font-semibold mb-3">Tus propiedades</h3>
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
                              disabled={turnPhase !== "rolled" || !isMyTurn}
                              className={`${rec.bg} ${rec.tx} px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:opacity-80 active:scale-95`}>
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
                <button onClick={() => { setTradeOther(cp === 0 ? 1 : 0); setTradeGive(eHand()); setTradeReceive(eHand()); setModal({ type: "playerTrade" }); }} disabled={turnPhase !== "rolled" || !isMyTurn}
                  className={`w-full py-3 rounded-xl font-bold transition-all ${turnPhase === "rolled" && isMyTurn ? "bg-blue-500 hover:bg-blue-400 text-white" : "bg-slate-700 text-slate-500 cursor-not-allowed"}`}>
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
                      <button onClick={() => removePort(port)} className="text-blue-400 hover:text-white ml-1">✕</button>
                    </span>
                  ))}
                  {cur.ports.length === 0 && <span className="text-slate-500 text-sm">Sin puertos</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {!cur.ports.includes("3:1") && (
                    <button onClick={() => addPort("3:1")} className="bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg text-sm">+ ⚓ 3:1</button>
                  )}
                  {RES.filter(r => !cur.ports.includes(r.id)).map(r => (
                    <button key={r.id} onClick={() => addPort(r.id)} className="bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg text-sm">+ {r.e} 2:1</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── CARTAS DE DESARROLLO ── */}
          {tab === "cartas" && (
            <div className="space-y-4">
              <div className="bg-slate-800 rounded-2xl p-4">
                <h3 className="text-slate-300 font-semibold mb-2">Tus cartas ({cur.devCards.length})</h3>
                {cur.devCards.length === 0 ? (
                  <p className="text-slate-500 text-sm">No tenés cartas de desarrollo</p>
                ) : (
                  <div className="space-y-2">
                    {cur.devCards.map((c, i) => (
                      <div key={i} className="bg-slate-700/50 rounded-xl p-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{DC[c].e}</span>
                          <div>
                            <div className="text-white text-sm font-medium">{DC[c].n}</div>
                            <div className="text-slate-400 text-xs">{DC[c].d}</div>
                          </div>
                        </div>
                        {c !== "victoria" && turnPhase === "rolled" && isMyTurn && (
                          <button onClick={() => playDevCard(c, i)}
                            className="px-3 py-1.5 bg-purple-500 hover:bg-purple-400 text-white rounded-lg text-sm font-medium">
                            Jugar
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-slate-500 text-sm text-center">Quedan {deck.length} cartas en el mazo</p>
            </div>
          )}

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
                    <button onClick={() => addFreeSettlement(i)}
                      className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded-lg">
                      + Poblado
                    </button>
                  </div>

                  {/* Resources */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {RES.map(r => (
                      <div key={r.id} className="flex items-center gap-1">
                        <button onClick={() => manualAdjust(i, r.id, -1)}
                          className="w-5 h-5 bg-slate-700 hover:bg-red-700 text-slate-400 hover:text-white rounded text-xs flex items-center justify-center">−</button>
                        <div className={`${r.bg} ${r.tx} px-2 py-0.5 rounded text-xs font-bold min-w-8 text-center`}>
                          {r.e}{p.hand[r.id]}
                        </div>
                        <button onClick={() => manualAdjust(i, r.id, 1)}
                          className="w-5 h-5 bg-slate-700 hover:bg-green-700 text-slate-400 hover:text-white rounded text-xs flex items-center justify-center">+</button>
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

            {/* Confirm build (Freemium MVP) */}
            {modal.type === "confirmBuild" && (() => {
              const type = modal.buildType;
              const cost = COSTS[type];
              return (
                <div>
                  <h3 className="text-xl font-bold text-amber-400 mb-2">Confirmar construcción</h3>
                  <p className="text-slate-300 text-sm mb-4">
                    Vas a construir <span className="font-semibold text-white">{COST_EMOJI[type]} {COST_NAMES[type]}</span>.
                  </p>
                  <div className="bg-slate-700/50 rounded-2xl p-4 mb-4">
                    <div className="text-slate-300 text-sm mb-2">Costo:</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(cost).map(([r, v]) => (
                        <ResBadge key={r} id={r} count={v} />
                      ))}
                    </div>
                  </div>
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