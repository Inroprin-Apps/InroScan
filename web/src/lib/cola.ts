"use client";

import { useSyncExternalStore } from "react";
import type { Herencia } from "./comprobante";

/**
 * Las fotos que todavía no llegaron al servidor, guardadas en el teléfono.
 *
 * Toda captura pasa por acá: primero se guarda (IndexedDB, sobrevive a cerrar
 * la app o reiniciar el teléfono) y recién después se sube. Si no hay señal,
 * espera; cuando vuelve, se sube y se lee sola. En iPhone solo se sube con la
 * app abierta: el sistema no deja trabajar en segundo plano.
 */

export type Pendiente = {
  clave: string;
  rendicionId: string;
  nombre: string;
  blob: Blob;
  mime: string;
  ext: string;
  base: Herencia;
  creado: string;
  /** El último motivo por el que no subió (sin señal, casi siempre). */
  error: string | null;
  /** Falló por algo que reintentar no arregla: espera a que la persona decida. */
  bloqueado?: boolean;
};

const BASE_DATOS = "inroscan";
const ALMACEN = "pendientes";

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, mal) => {
    const pedido = indexedDB.open(BASE_DATOS, 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore(ALMACEN, { keyPath: "clave" });
    pedido.onsuccess = () => ok(pedido.result);
    pedido.onerror = () => mal(pedido.error);
  });
}

async function operar<T>(modo: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await abrir();
  return new Promise((ok, mal) => {
    const t = db.transaction(ALMACEN, modo);
    const pedido = f(t.objectStore(ALMACEN));
    t.oncomplete = () => {
      db.close();
      ok(pedido.result);
    };
    t.onerror = () => {
      db.close();
      mal(t.error);
    };
  });
}

let actual: Pendiente[] = [];
const oyentes = new Set<() => void>();

export async function refrescar() {
  try {
    actual = (await operar("readonly", (s) => s.getAll() as IDBRequest<Pendiente[]>)).sort((a, b) => a.creado.localeCompare(b.creado));
  } catch {
    actual = [];
  }
  oyentes.forEach((f) => f());
}

export async function guardar(p: Pendiente): Promise<void> {
  await operar("readwrite", (s) => s.put(p));
  await refrescar();
}

export async function quitar(clave: string): Promise<void> {
  await operar("readwrite", (s) => s.delete(clave));
  await refrescar();
}

let leido = false;
function suscribir(f: () => void) {
  oyentes.add(f);
  if (!leido) {
    leido = true;
    refrescar();
  }
  return () => oyentes.delete(f);
}

const vacia: Pendiente[] = [];

/** Lo que espera subir; de una rendición, o de todas. */
export function usePendientes(rendicionId?: string): Pendiente[] {
  const todos = useSyncExternalStore(suscribir, () => actual, () => vacia);
  return rendicionId ? todos.filter((p) => p.rendicionId === rendicionId) : todos;
}

export const pendientesActuales = () => actual;
