// ═══════════════════════════════════════════════
//  DIAGNÓSTICO Y TELEMETRÍA
//
//  El problema real que resuelve: un crash pasa en el celular de otro, en la
//  mesa, y nadie se acuerda de qué estaba haciendo. El ErrorBoundary ya evita
//  la pantalla blanca, pero el error se iba a la consola de un celular que
//  nadie va a abrir.
//
//  Entonces: los errores se guardan en el propio dispositivo (últimos 10) y se
//  pueden copiar desde la app. Si además hay un endpoint configurado, se
//  mandan; sin configurar, no se manda nada y no se pide ningún permiso.
//
//  Sin `VITE_ERROR_ENDPOINT` / `VITE_ANALYTICS_ENDPOINT` esto es todo local:
//  no hay red, no hay terceros, no hay cookies.
// ═══════════════════════════════════════════════

const ERR_KEY = "catan.errores.v1";
const MAX_ERRORS = 10;

const ERROR_ENDPOINT = import.meta.env.VITE_ERROR_ENDPOINT || "";
const ANALYTICS_ENDPOINT = import.meta.env.VITE_ANALYTICS_ENDPOINT || "";
const APP_VERSION = import.meta.env.VITE_APP_VERSION || "dev";

export const errorReportingEnabled = Boolean(ERROR_ENDPOINT);
export const analyticsEnabled = Boolean(ANALYTICS_ENDPOINT);

// ── Registro local ──

export const loadErrors = () => {
  try {
    const raw = localStorage.getItem(ERR_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return Array.isArray(data?.errors) ? data.errors : [];
  } catch {
    return [];
  }
};

export const clearErrors = () => {
  try { localStorage.removeItem(ERR_KEY); } catch { /* sin storage */ }
};

const saveErrors = (errors) => {
  try {
    localStorage.setItem(ERR_KEY, JSON.stringify({ v: 1, errors: errors.slice(0, MAX_ERRORS) }));
  } catch { /* storage lleno: el error igual se reporta si hay endpoint */ }
};

// Los stacks de un bundle minificado son largos y poco útiles enteros: con las
// primeras líneas alcanza para ubicar el crash, y el registro no se infla.
const trimStack = (stack) => (typeof stack === "string" ? stack.split("\n").slice(0, 6).join("\n") : "");

// `keepalive` para que el envío sobreviva a la recarga que hace el usuario
// justo después del crash. Nunca propaga: fallar al reportar no puede ser otro
// error en pantalla.
const post = (url, payload) => {
  if (!url) return;
  try {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => { /* sin red: se queda en el registro local */ });
  } catch { /* fetch no disponible */ }
};

// ── Errores ──

export function reportError(error, context = {}) {
  const entry = {
    at: Date.now(),
    message: String(error?.message || error || "Error desconocido").slice(0, 300),
    stack: trimStack(error?.stack),
    context,
    version: APP_VERSION,
    ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 180) : "",
  };
  // El registro local es lo que siempre pasa; el envío es lo opcional.
  saveErrors([entry, ...loadErrors()]);
  post(ERROR_ENDPOINT, { kind: "error", ...entry });
  return entry;
}

// Engancha los errores que React no ve: los de fuera del árbol y las promesas
// rechazadas. Devuelve la función para desengancharlos.
export function installErrorHandlers() {
  if (typeof window === "undefined") return () => {};
  const onError = (e) => reportError(e.error || e.message, { type: "window.onerror", src: e.filename || "" });
  const onRejection = (e) => reportError(e.reason, { type: "unhandledrejection" });
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

// Texto para pegar en un issue: lo que se copia desde el panel de diagnóstico.
export function formatErrorsForReport(errors = loadErrors()) {
  if (errors.length === 0) return "Sin errores registrados.";
  return errors.map((e, i) => [
    `#${i + 1} — ${new Date(e.at).toISOString()} (v${e.version || "?"})`,
    e.message,
    e.stack || "(sin stack)",
    e.context && Object.keys(e.context).length ? `contexto: ${JSON.stringify(e.context)}` : "",
    e.ua ? `dispositivo: ${e.ua}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");
}

// ── Analytics ──
//
// Eventos de producto, sin identificar a nadie: no hay id de usuario, ni
// cookies, ni nombres de jugadores. Solo forma de uso (qué modo, cuántos
// jugadores, si la partida se terminó).
export function trackEvent(name, props = {}) {
  if (!ANALYTICS_ENDPOINT) return;
  post(ANALYTICS_ENDPOINT, {
    kind: "event",
    name,
    props,
    at: Date.now(),
    version: APP_VERSION,
  });
}
