"use client";

import { useSyncExternalStore } from "react";

function suscribir(f: () => void) {
  window.addEventListener("online", f);
  window.addEventListener("offline", f);
  return () => {
    window.removeEventListener("online", f);
    window.removeEventListener("offline", f);
  };
}

/** Si el equipo dice tener red. Puede decir que sí y fallar igual; nunca dice que no en falso. */
export function useEnLinea(): boolean {
  return useSyncExternalStore(suscribir, () => navigator.onLine, () => true);
}
