// Persistencia del historial en Supabase (opcional: sin configurar, la app
// usa solo el historial local).
//
// Sin login: la sesión anónima (auth.uid()) identifica al dispositivo. El
// dueño de la partida es quien la creó; los demás dispositivos se registran
// como participantes para que les aparezca en su lista.
import { supabase, ensureAnonSession } from "../online/supabaseClient.js";

const PROFILE_KEY = "catan.perfil.v1";

export const loadProfileName = () => {
  try { return localStorage.getItem(PROFILE_KEY) || ""; } catch { return ""; }
};
export const saveProfileName = (name) => {
  try { localStorage.setItem(PROFILE_KEY, name); } catch { /* sin storage */ }
};

export async function syncProfile(displayName) {
  if (!supabase) return null;
  const uid = await ensureAnonSession();
  await supabase.from("profiles").upsert({
    user_id: uid,
    display_name: displayName || null,
    last_seen_at: new Date().toISOString(),
  });
  return uid;
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

// Sube (o actualiza) el resumen de una partida. Idempotente: la misma partida
// guardada dos veces reescribe las mismas filas.
export async function pushGame(summary, { roomCode = null, seatOwners = {} } = {}) {
  if (!supabase || !summary?.id) return null;
  const uid = await ensureAnonSession();

  const { error } = await supabase.from("games").upsert({
    id: summary.id,
    owner_id: uid,
    room_code: roomCode,
    mode: summary.mode,
    expansion: summary.expansion,
    player_count: summary.playerCount,
    status: summary.status,
    started_at: iso(summary.startedAt),
    ended_at: iso(summary.endedAt),
    duration_seconds: summary.durationSeconds,
    turns: summary.turns,
    roll_count: summary.rollCount,
    dice_totals: summary.diceTotals,
    winner_index: summary.winnerIndex,
    winner_name: summary.winnerName,
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
  // El dueño es el primero que la subió: si otro dispositivo intenta
  // reescribirla, RLS lo rechaza y alcanza con registrarse como participante.
  if (error) {
    await supabase.from("game_participants").upsert({ game_id: summary.id, user_id: uid });
    return { owned: false };
  }

  await supabase.from("game_participants").upsert({ game_id: summary.id, user_id: uid });

  if (summary.players.length > 0) {
    await supabase.from("game_players").upsert(summary.players.map(p => ({
      game_id: summary.id,
      player_index: p.playerIndex,
      name: p.name,
      color_index: p.colorIndex,
      user_id: seatOwners[p.playerIndex] || null,
      vp: p.vp, vp_base: p.vpBase,
      settlements: p.settlements, cities: p.cities,
      roads_built: p.roadsBuilt, knights: p.knights, dev_cards: p.devCards,
      longest_road: p.longestRoad, largest_army: p.largestArmy,
    })), { onConflict: "game_id,player_index" });
  }

  if (summary.rolls.length > 0) {
    await supabase.from("game_rolls").upsert(summary.rolls.map(r => ({
      game_id: summary.id,
      seq: r.seq, d1: r.d1, d2: r.d2, total: r.total,
      player_index: r.playerIndex, manual: r.manual, rolled_at: iso(r.ts),
    })), { onConflict: "game_id,seq" });
  }
  return { owned: true };
}

// Partidas del dispositivo (propias o donde participó), con sus jugadores.
export async function fetchGames(limit = 50) {
  if (!supabase) return [];
  await ensureAnonSession();
  const { data, error } = await supabase
    .from("games")
    .select("*, game_players(*)")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map(g => ({
    id: g.id,
    remote: true,
    roomCode: g.room_code,
    mode: g.mode,
    expansion: g.expansion,
    playerCount: g.player_count,
    status: g.status,
    startedAt: g.started_at ? Date.parse(g.started_at) : null,
    endedAt: g.ended_at ? Date.parse(g.ended_at) : null,
    durationSeconds: g.duration_seconds,
    turns: g.turns,
    rollCount: g.roll_count,
    diceTotals: g.dice_totals || {},
    winnerIndex: g.winner_index,
    winnerName: g.winner_name,
    players: (g.game_players || [])
      .sort((a, b) => a.player_index - b.player_index)
      .map(p => ({
        playerIndex: p.player_index, name: p.name, colorIndex: p.color_index,
        vp: p.vp, vpBase: p.vp_base, settlements: p.settlements, cities: p.cities,
        roadsBuilt: p.roads_built, knights: p.knights, devCards: p.dev_cards,
        longestRoad: p.longest_road, largestArmy: p.largest_army,
      })),
    rolls: [],
  }));
}

// Tiradas de una partida (se piden solo al abrir el detalle).
export async function fetchRolls(gameId) {
  if (!supabase) return [];
  const { data } = await supabase.from("game_rolls").select("*").eq("game_id", gameId).order("seq");
  return (data || []).map(r => ({
    seq: r.seq, d1: r.d1, d2: r.d2, total: r.total,
    playerIndex: r.player_index, manual: r.manual, ts: r.rolled_at ? Date.parse(r.rolled_at) : null,
  }));
}
