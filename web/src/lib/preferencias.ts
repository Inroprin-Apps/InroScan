"use client";

import { useSyncExternalStore } from "react";

/**
 * Preferencias de pantalla de cada equipo (no de la cuenta): se guardan en el
 * navegador y, si no se puede, simplemente no se recuerdan.
 */

const BARRA = "inroscan.barra-contraida";
const oyentes = new Set<() => void>();

function leer(): boolean {
  try {
    return localStorage.getItem(BARRA) === "1";
  } catch {
    return false;
  }
}

export function useBarraContraida(): [boolean, (v: boolean) => void] {
  const contraida = useSyncExternalStore(
    (f) => {
      oyentes.add(f);
      return () => oyentes.delete(f);
    },
    leer,
    () => false,
  );
  const cambiar = (v: boolean) => {
    try {
      localStorage.setItem(BARRA, v ? "1" : "0");
    } catch {
      // sin almacenamiento: vale solo para esta visita
    }
    oyentes.forEach((f) => f());
  };
  return [contraida, cambiar];
}
