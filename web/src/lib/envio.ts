"use client";

import { guardar, pendientesActuales, quitar, refrescar, type Pendiente } from "./cola";
import type { Herencia } from "./comprobante";
import { YA_SUBIDO, esSinConexion, leer, preparar, subirPreparado } from "./subida";

/**
 * Sube lo que espera en el teléfono. Se llama al capturar, al volver la
 * señal, al volver a la app y cada tanto mientras quede algo.
 */

const EN_PARALELO = 3;
let trabajando: Promise<void> | null = null;
const oyentes = new Set<(rendicionId: string) => void>();

/** Avisa cuando un archivo de una rendición llegó al servidor (o terminó de leerse). */
export function alSubir(f: (rendicionId: string) => void): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}
const avisar = (rid: string) => oyentes.forEach((f) => f(rid));

/** Guarda en el teléfono y, si hay señal, sube enseguida. */
export async function capturar(rendicionId: string, archivos: File[], base: Herencia): Promise<string[]> {
  const errores: string[] = [];
  for (const f of archivos) {
    try {
      const p = await preparar(f);
      await guardar({
        clave: crypto.randomUUID(),
        rendicionId,
        nombre: f.name || "Foto",
        ...p,
        base,
        creado: new Date().toISOString(),
        error: null,
      });
    } catch (e) {
      errores.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  procesarCola();
  return errores;
}

async function una(p: Pendiente): Promise<"listo" | "sin-senal"> {
  try {
    const archivoId = await subirPreparado(p.rendicionId, p, p.base);
    await quitar(p.clave);
    avisar(p.rendicionId);
    // La lectura sigue sola en el servidor; se espera solo para avisar al terminar.
    leer(archivoId)
      .catch(() => {})
      .finally(() => avisar(p.rendicionId));
    return "listo";
  } catch (e) {
    // Subió en un intento anterior aunque la respuesta se perdió: ya está.
    if ((e as Error).message === YA_SUBIDO) {
      await quitar(p.clave);
      avisar(p.rendicionId);
      return "listo";
    }
    if (esSinConexion(e)) {
      await guardar({ ...p, error: "Sin señal" });
      return "sin-senal";
    }
    await guardar({ ...p, error: (e as Error).message, bloqueado: true });
    return "listo";
  }
}

export function procesarCola(): Promise<void> {
  if (trabajando) return trabajando;
  trabajando = (async () => {
    await refrescar();
    if (!navigator.onLine) return;
    const cola = pendientesActuales().filter((p) => !p.bloqueado);
    let sinSenal = false;
    const trabajador = async () => {
      for (let p = cola.shift(); p && !sinSenal; p = cola.shift()) {
        if ((await una(p)) === "sin-senal") sinSenal = true;
      }
    };
    await Promise.all(Array.from({ length: EN_PARALELO }, trabajador));
  })().finally(() => {
    trabajando = null;
  });
  return trabajando;
}

/** Vuelve a intentar uno que había fallado por otra cosa que la señal. */
export async function reintentar(p: Pendiente): Promise<void> {
  await guardar({ ...p, error: null, bloqueado: false });
  await procesarCola();
}
