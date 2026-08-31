// Descripción humana de una acción, para el modal de "Deshacer".
// `preState` es el estado ANTES de aplicar la acción (para resolver nombres).
export const describeAction = (action, preState) => {
  const name = (i) => preState.players[i]?.name || `Jugador ${i + 1}`;
  const cpName = name(preState.cp);
  switch (action.type) {
    case "CREATE_LOBBY": return "Creación de la sala";
    case "SET_PLAYER_NAME": return `Nombre/color de ${name(action.player)}`;
    case "SET_INITIAL_SETTLEMENTS": return `Poblados iniciales de ${name(action.player)}`;
    case "BEGIN_GAME": return "Comienzo de la partida";
    case "START_GAME": return "Inicio de partida";
    case "ROLL": return `${action.manual ? "Número ingresado" : "Tirada de dados"}: ${action.d1 + action.d2} (${cpName})`;
    case "DISCARD": return `Descarte de ${name(action.player)}`;
    case "PLACE_ROBBER": return `Ladrón colocado en el ${action.num}`;
    case "UPGRADE_CITY_FREE": return `Ciudad marcada a ${name(action.player)}`;
    case "ADJUST_DEV": return `Ajuste de cartas de desarrollo (${name(action.player)})`;
    case "ADJUST_STAT": return `Ajuste de ${action.stat === "knightsPlayed" ? "caballeros" : "caminos"} (${name(action.player)})`;
    case "SET_TITLE": return action.player === null
      ? `${action.title === "longestRoad" ? "Camino más largo" : "Ejército más grande"}: automático`
      : `${action.title === "longestRoad" ? "Camino más largo" : "Ejército más grande"} a ${name(action.player)}`;
    case "STEAL": return `${cpName} le robó una carta a ${name(action.victim)}`;
    case "BUILD_ROAD": return `Camino construido por ${cpName}`;
    case "ADD_SETTLEMENT": return `Poblado construido por ${cpName}`;
    case "UPGRADE_CITY": return `Ciudad de ${cpName}`;
    case "BUY_DEV": return `Carta de desarrollo comprada por ${cpName}`;
    case "PLAY_DEV": return `Carta de desarrollo jugada por ${cpName}`;
    case "MONOPOLY": return `Monopolio jugado por ${cpName}`;
    case "YEAR_OF_PLENTY": return `Abundancia jugada por ${cpName}`;
    case "TRADE_BANK": return `Comercio con el banco (${cpName})`;
    case "TRADE_PLAYER": return `Comercio entre ${cpName} y ${name(action.other)}`;
    case "ADD_PORT": return `Puerto agregado a ${cpName}`;
    case "REMOVE_PORT": return `Puerto quitado a ${cpName}`;
    case "ADD_FREE_SETTLEMENT": return `Poblado agregado a ${name(action.player)}`;
    case "MANUAL_ADJUST": return `Ajuste manual de recursos (${name(action.player)})`;
    case "MOVE_PLAYER": return "Cambio de orden de turnos";
    case "END_TURN": return `Fin de turno de ${cpName}`;
    default: return action.type;
  }
};
