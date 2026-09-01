import { useState, useCallback, useEffect, useRef } from "react";
import { summarizeGame } from "../game/summary.js";
import { pushGame, fetchGames, fetchRolls, syncProfile, loadProfileName, saveProfileName } from "./gamesRepo.js";
import { isOnlineConfigured } from "../online/supabaseClient.js";

// ═══════════════════════════════════════════════
//  HISTORIAL EN LA NUBE
//
//  El archivo local de partidas es `game/history.js` (guarda el log completo
//  y lo reabre con el StatsPanel). Esto es la capa de arriba: sube el resumen
//  de cada partida a Supabase para tenerlas en la base y verlas desde otro
//  dispositivo. Sin Supabase configurado no hace nada y la app sigue igual.
//
//  El resumen se deriva del log con summarizeGame y el id de la partida es el
//  uid de su primera acción (el mismo que usa el archivo local), así que subir
//  dos veces la misma partida reescribe sus filas en vez de duplicarlas.
// ═══════════════════════════════════════════════
export function useGameHistory() {
  const [games, setGames] = useState([]);       // partidas en la nube
  const [loading, setLoading] = useState(false);
  const [profileName, setProfileNameState] = useState(() => loadProfileName());
  const lastSavedRef = useRef({}); // id → cantidad de acciones ya subidas

  const setProfileName = useCallback((name) => {
    setProfileNameState(name);
    saveProfileName(name);
    if (isOnlineConfigured) syncProfile(name).catch(() => { /* se reintenta al subir una partida */ });
  }, []);

  // Sube el resumen. `force` ignora el corte por cantidad de acciones (se usa
  // al terminar, para que el resultado final quede sí o sí).
  const saveGame = useCallback(async (actions, { roomCode = null, seatOwners = {}, force = false } = {}) => {
    if (!isOnlineConfigured) return null;
    const summary = summarizeGame(actions);
    if (!summary) return null;
    const prev = lastSavedRef.current[summary.id] || 0;
    if (!force && actions.length - prev < 10) return summary;
    lastSavedRef.current[summary.id] = actions.length;
    try { await pushGame(summary, { roomCode, seatOwners }); } catch { /* queda el archivo local */ }
    return summary;
  }, []);

  const refresh = useCallback(async () => {
    if (!isOnlineConfigured) return [];
    setLoading(true);
    let list = [];
    try { list = await fetchGames(); setGames(list); } catch { /* sin red: solo local */ }
    setLoading(false);
    return list;
  }, []);

  // Las tiradas de una partida vieja se piden solo al abrir el detalle.
  const getRolls = useCallback(async (game) => {
    if (game?.rolls?.length) return game.rolls;
    if (!isOnlineConfigured || !game?.id) return [];
    try { return await fetchRolls(game.id); } catch { return []; }
  }, []);

  // Registra el perfil guardado del dispositivo (solo al montar).
  useEffect(() => {
    if (isOnlineConfigured && profileName) syncProfile(profileName).catch(() => { /* mejor esfuerzo */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isConfigured: isOnlineConfigured, games, loading, profileName, setProfileName, saveGame, refresh, getRolls };
}
