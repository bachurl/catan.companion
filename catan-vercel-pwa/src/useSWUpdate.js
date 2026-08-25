import { useEffect, useState, useCallback } from "react";

// Registra el service worker y expone si hay una versión nueva esperando.
// applyUpdate() la activa y recarga la página (la partida está autosaveada).
export function useSWUpdate() {
  const [waitingWorker, setWaitingWorker] = useState(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let reg;

    const onUpdateFound = () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        // "installed" + controller existente = hay versión nueva esperando
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          setWaitingWorker(installing);
        }
      });
    };

    navigator.serviceWorker.register("/sw.js").then(r => {
      reg = r;
      if (r.waiting && navigator.serviceWorker.controller) setWaitingWorker(r.waiting);
      r.addEventListener("updatefound", onUpdateFound);
    }).catch(() => { /* sin SW (dev, navegador viejo): la app funciona igual */ });

    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  const applyUpdate = useCallback(() => {
    if (waitingWorker) waitingWorker.postMessage("SKIP_WAITING");
  }, [waitingWorker]);

  return { updateReady: waitingWorker !== null, applyUpdate };
}
