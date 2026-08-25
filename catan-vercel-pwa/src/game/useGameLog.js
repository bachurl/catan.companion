import { useState, useCallback } from "react";
import { initialGameState, gameReducer, replayActions } from "./reducer";

// Hook que mantiene el par {estado, log de acciones}.
// Toda mutación del juego pasa por dispatchAction; el estado siempre es
// derivable replayando `actions` desde initialGameState.
export function useGameLog() {
  const [game, setGame] = useState(initialGameState);
  const [actions, setActions] = useState([]);

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
  }, []);

  return { game, actions, dispatchAction, replaceActions, resetGame };
}
