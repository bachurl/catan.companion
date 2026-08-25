import { useState, useCallback, useEffect } from "react";
import { initialGameState, gameReducer, replayActions } from "./reducer.js";

// ── Persistencia local ──
// Se guarda el log de acciones (no el estado): al cargar se replaya.
const STORAGE_KEY = "catan.partida.v1";

export const loadSavedActions = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.actions) || data.actions.length === 0) return null;
    return data.actions;
  } catch {
    return null;
  }
};

export const clearSavedActions = () => {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage no disponible */ }
};

const saveActions = (actions) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, savedAt: Date.now(), actions }));
  } catch { /* storage lleno o no disponible: la partida sigue en memoria */ }
};

// Hook que mantiene el par {estado, log de acciones}.
// Toda mutación del juego pasa por dispatchAction; el estado siempre es
// derivable replayando `actions` desde initialGameState.
export function useGameLog() {
  const [game, setGame] = useState(initialGameState);
  const [actions, setActions] = useState([]);

  // Autosave: cada cambio del log persiste la partida completa.
  useEffect(() => {
    if (actions.length > 0) saveActions(actions);
  }, [actions]);

  const dispatchAction = useCallback((action) => {
    const stamped = { ts: Date.now(), ...action };
    setGame(s => gameReducer(s, stamped));
    setActions(a => [...a, stamped]);
    return stamped;
  }, []);

  // Reemplaza el log completo y recalcula el estado (cargar partida, deshacer, sync).
  const replaceActions = useCallback((newActions) => {
    setActions(newActions);
    setGame(replayActions(newActions));
  }, []);

  const resetGame = useCallback(() => {
    setActions([]);
    setGame(initialGameState);
    clearSavedActions();
  }, []);

  return { game, actions, dispatchAction, replaceActions, resetGame };
}
