import { useState, useCallback, useRef, useEffect } from "react";
import { summarizeGame } from "../game/summary.js";
import { loadLocalHistory, upsertLocalGame, removeLocalGame } from "./localHistory.js";
import { pushGame, fetchGames, fetchRolls, syncProfile, loadProfileName, saveProfileName } from "./gamesRepo.js";
import { isOnlineConfigured } from "../online/supabaseClient.js";

// ═══════════════════════════════════════════════
//  HISTORIAL DE PARTIDAS
//
//  Local siempre (funciona sin Supabase y sin conexión) y, si hay Supabase,
//  además en la nube. El resumen se recalcula del log con summarizeGame, así
//  que guardar es idempotente: la misma partida se reescribe, no se duplica.
// ═══════════════════════════════════════════════
export function useGameHistory() {
  const [games, setGames] = useState(() => loadLocalHistory());
  const [profileName, setProfileNameState] = useState(() => loadProfileName());
  const [loading, setLoading] = useState(false);
  const lastSavedRef = useRef({}); // id → cantidad de acciones ya guardadas

  const setProfileName = useCallback((name) => {
    setProfileNameState(name);
    saveProfileName(name);
    if (isOnlineConfigured) syncProfile(name).catch(() => { /* se reintenta al guardar una partida */ });
  }, []);

  // Guarda el resumen de una partida. `force` ignora el corte por cantidad de
  // acciones (se usa al terminar, para que el resultado final quede sí o sí).
  const saveGame = useCallback(async (actions, { roomCode = null, seatOwners = {}, force = false } = {}) => {
    const summary = summarizeGame(actions);
    if (!summary) return null;
    // Autosave: no reescribir en cada acción, solo cada 10 (o al forzar).
    const prev = lastSavedRef.current[summary.id] || 0;
    if (!force && actions.length - prev < 10) return summary;
    lastSavedRef.current[summary.id] = actions.length;

    setGames(upsertLocalGame({ ...summary, roomCode }));
    if (isOnlineConfigured) {
      try { await pushGame(summary, { roomCode, seatOwners }); } catch { /* queda el local */ }
    }
    return summary;
  }, []);

  // Lista combinada: lo remoto manda (tiene los datos de todos los celulares)
  // y lo local completa las partidas que nunca llegaron a subirse.
  const refresh = useCallback(async () => {
    const local = loadLocalHistory();
    if (!isOnlineConfigured) { setGames(local); return local; }
    setLoading(true);
    let merged = local;
    try {
      const remote = await fetchGames();
      const byId = new Map(local.map(g => [g.id, g]));
      remote.forEach(g => byId.set(g.id, { ...byId.get(g.id), ...g }));
      merged = [...byId.values()].sort((a, b) => (b.endedAt || b.startedAt || 0) - (a.endedAt || a.startedAt || 0));
      setGames(merged);
    } catch { setGames(local); }
    setLoading(false);
    return merged;
  }, []);

  const deleteGame = useCallback((id) => setGames(removeLocalGame(id)), []);

  // Las tiradas de una partida vieja pueden estar solo en la nube.
  const getRolls = useCallback(async (game) => {
    if (game?.rolls?.length) return game.rolls;
    if (!isOnlineConfigured || !game?.id) return [];
    try { return await fetchRolls(game.id); } catch { return []; }
  }, []);

  useEffect(() => {
    if (isOnlineConfigured && profileName) syncProfile(profileName).catch(() => { /* mejor esfuerzo */ });
    // Solo al montar: registra el perfil guardado del dispositivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { games, loading, profileName, setProfileName, saveGame, refresh, deleteGame, getRolls };
}
