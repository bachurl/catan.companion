import { useEffect } from "react";

// Mantiene la pantalla encendida mientras `active` sea true (Screen Wake
// Lock API). El lock se pierde al cambiar de pestaña o bloquear el teléfono;
// se re-adquiere al volver. En navegadores sin soporte no hace nada.
export function useWakeLock(active) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;

    let lock = null;
    let released = false;

    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
        if (released) lock.release().catch(() => {});
      } catch { /* denegado (batería baja, etc.): no es crítico */ }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (lock) lock.release().catch(() => {});
    };
  }, [active]);
}

// Vibración corta como feedback táctil (no-op si no hay soporte).
export const vibrate = (pattern = 60) => {
  try { navigator.vibrate?.(pattern); } catch { /* sin soporte */ }
};
