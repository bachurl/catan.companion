// Historial local de partidas.
// Es la fuente de verdad offline: funciona sin Supabase configurado y sin
// conexión. Guarda el resumen (no el log completo) para no llenar el storage.
const KEY = "catan.historial.v1";
const MAX = 60;

export const loadLocalHistory = () => {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

const save = (list) => {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* sin storage */ }
};

// Inserta o reemplaza por id y deja lo más reciente primero.
export const upsertLocalGame = (summary) => {
  if (!summary?.id) return loadLocalHistory();
  const rest = loadLocalHistory().filter(g => g.id !== summary.id);
  const list = [{ ...summary, savedAt: Date.now() }, ...rest]
    .sort((a, b) => (b.endedAt || b.startedAt || 0) - (a.endedAt || a.startedAt || 0));
  save(list);
  return list;
};

export const removeLocalGame = (id) => {
  const list = loadLocalHistory().filter(g => g.id !== id);
  save(list);
  return list;
};

export const clearLocalHistory = () => { try { localStorage.removeItem(KEY); } catch { /* sin storage */ } };
