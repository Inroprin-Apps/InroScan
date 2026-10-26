"use client";

import { useSyncExternalStore } from "react";
import { leerCatalogos } from "./datos";
import type { Catalogos } from "./tipos";

// Cambian muy de vez en cuando: se leen una vez por visita, no por pantalla,
// y se vuelven a leer cuando administración los edita.
type Estado = { catalogos: Catalogos | null; error: string | null };

let actual: Estado = { catalogos: null, error: null };
let enCurso: Promise<void> | null = null;
const oyentes = new Set<() => void>();

export function recargarCatalogos(): Promise<void> {
  enCurso = leerCatalogos()
    .then(
      (catalogos) => {
        actual = { catalogos, error: null };
      },
      (e: Error) => {
        actual = { ...actual, error: e.message };
      },
    )
    .finally(() => {
      enCurso = null;
      oyentes.forEach((f) => f());
    });
  return enCurso;
}

function suscribir(f: () => void) {
  oyentes.add(f);
  if (!actual.catalogos && !enCurso) recargarCatalogos();
  return () => oyentes.delete(f);
}

const sinDatos: Estado = { catalogos: null, error: null };

export function useCatalogos(): Estado {
  return useSyncExternalStore(suscribir, () => actual, () => sinDatos);
}
