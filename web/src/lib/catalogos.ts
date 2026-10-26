"use client";

import { useEffect, useState } from "react";
import { leerCatalogos } from "./datos";
import type { Catalogos } from "./tipos";

// Cambian muy de vez en cuando: se leen una vez por visita, no por pantalla.
let enCurso: Promise<Catalogos> | null = null;

export function useCatalogos(): { catalogos: Catalogos | null; error: string | null } {
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    enCurso ??= leerCatalogos();
    let vigente = true;
    enCurso.then(
      (c) => vigente && setCatalogos(c),
      (e: Error) => {
        enCurso = null; // que el próximo intento vuelva a pedirlos
        if (vigente) setError(e.message);
      },
    );
    return () => {
      vigente = false;
    };
  }, []);

  return { catalogos, error };
}
