import { useState, useCallback, useEffect, useRef } from "react";
import { initialGameState, gameReducer, replayActions } from "./reducer.js";

// ── Persistencia local ──
// Se guarda el log de acciones (no el estado): al cargar se replaya.
const STORAGE_KEY = "catan.partida.v1";

export const loadSavedGame = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.actions) || data.actions.length === 0) return null;
    return { actions: data.actions };
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

const newUid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// Hook que mantiene el par {estado, log de acciones}.
// Toda mutación del juego pasa por dispatchAction; el estado siempre es
// derivable replayando `actions` desde initialGameState. Cada acción lleva
// un `uid` para dedupe al sincronizar online.
export function useGameLog() {
  const [game, setGame] = useState(initialGameState);
  const [actions, setActions] = useState([]);
  const actionsRef = useRef(actions);

  // Autosave: cada cambio del log persiste la partida completa.
  useEffect(() => {
    if (actions.length > 0) saveActions(actions);
  }, [actions]);

  const dispatchAction = useCallback((action) => {
    const stamped = { ts: Date.now(), uid: newUid(), ...action };
    const next = [...actionsRef.current, stamped];
    actionsRef.current = next;
    setActions(next);
    // UNDO no es un case del reducer: requiere replay completo.
    if (stamped.type === "UNDO") setGame(replayActions(next));
    else setGame(s => gameReducer(s, stamped));
    return stamped;
  }, []);

  // Reemplaza el log completo y recalcula el estado (cargar partida, deshacer, sync).
  const replaceActions = useCallback((newActions) => {
    actionsRef.current = newActions;
    setActions(newActions);
    setGame(replayActions(newActions));
  }, []);

  const resetGame = useCallback(() => {
    actionsRef.current = [];
    setActions([]);
    setGame(initialGameState);
    clearSavedActions();
  }, []);

  return { game, actions, dispatchAction, replaceActions, resetGame };
}
