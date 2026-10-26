"use client";

import { useEffect, useRef, useState } from "react";
import { herencia } from "@/lib/comprobante";
import type { Persona } from "@/lib/sesion";
import { leer, subir } from "@/lib/subida";
import type { Comprobante, Rendicion } from "@/lib/tipos";
import { IconoCamara, IconoSubir } from "../iconos";
import { botonPrincipal, botonSecundario } from "../piezas";

/** Un archivo en camino, mientras esta pantalla lo sube y espera su lectura. */
export type Subida = {
  clave: string;
  nombre: string;
  estado: "subiendo" | "leyendo" | "listo" | "error";
  error?: string;
};

/** Cuántos archivos se suben y leen a la vez. */
const EN_PARALELO = 3;

export function useSubidas({
  obtener,
  persona,
  filasActuales,
  recargar,
  alPedirLectura,
}: {
  /** La rendición al momento de subir (la pantalla puede no tenerla todavía). */
  obtener: () => Rendicion | null;
  persona: Persona;
  filasActuales: () => Comprobante[];
  recargar: () => Promise<void>;
  alPedirLectura: (archivoId: string) => void;
}) {
  const [subidas, setSubidas] = useState<Subida[]>([]);

  const cambiar = (clave: string, cambios: Partial<Subida>) =>
    setSubidas((l) => l.map((s) => (s.clave === clave ? { ...s, ...cambios } : s)));

  const recibir = async (lista: File[]) => {
    const rendicion = obtener();
    if (!lista.length || !rendicion) return;
    const nuevas = lista.map((f) => ({ archivo: f, clave: crypto.randomUUID() }));
    setSubidas((l) => [
      ...l.filter((s) => s.estado !== "listo"),
      ...nuevas.map(({ archivo, clave }) => ({ clave, nombre: archivo.name, estado: "subiendo" as const })),
    ]);
    // Lo que se hereda se calcula una vez: todo el lote va al mismo proyecto.
    const base = herencia(filasActuales(), rendicion.tipo, persona);
    const cola = [...nuevas];
    const trabajador = async () => {
      for (let n = cola.shift(); n; n = cola.shift()) {
        let archivoId: string | null = null;
        try {
          archivoId = await subir(rendicion.id, n.archivo, base);
          alPedirLectura(archivoId);
          cambiar(n.clave, { estado: "leyendo" });
          await recargar(); // la fila aparece ya, con «Leyendo…»
          await leer(archivoId);
          cambiar(n.clave, { estado: "listo" });
        } catch (e) {
          cambiar(n.clave, { estado: "error", error: (e as Error).message });
        }
        if (archivoId) await recargar();
      }
    };
    await Promise.all(Array.from({ length: Math.min(EN_PARALELO, nuevas.length) }, trabajador));
  };

  return { subidas, recibir };
}

/** «Subir fotos o PDF», y en teléfono además la cámara. */
export function BotonesSubida({ onArchivos, grande }: { onArchivos: (l: File[]) => void; grande?: boolean }) {
  const elegir = useRef<HTMLInputElement>(null);
  const camara = useRef<HTMLInputElement>(null);
  const tomar = (l: FileList | null) => l && onArchivos([...l]);
  const alto = grande ? "h-14 text-base" : "";
  return (
    <>
      <button type="button" onClick={() => camara.current?.click()} className={`flex items-center justify-center gap-2 md:hidden ${botonPrincipal} ${alto}`}>
        <IconoCamara className="h-5 w-5" />
        Tomar foto
      </button>
      <button type="button" onClick={() => elegir.current?.click()} className={`flex items-center justify-center gap-2 md:hidden ${botonSecundario} ${alto}`}>
        Galería o PDF
      </button>
      <button type="button" onClick={() => elegir.current?.click()} className={`hidden items-center gap-2 md:flex ${botonPrincipal}`}>
        <IconoSubir className="h-4 w-4" />
        Subir fotos o PDF
      </button>
      <input
        ref={camara}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label="Tomar foto"
        onChange={(e) => {
          tomar(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={elegir}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        aria-label="Elegir fotos o PDF"
        onChange={(e) => {
          tomar(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
}

export function ListaSubidas({ subidas }: { subidas: Subida[] }) {
  const activas = subidas.filter((s) => s.estado !== "listo");
  const listos = subidas.filter((s) => s.estado === "listo").length;
  const trabajando = subidas.some((s) => s.estado === "subiendo" || s.estado === "leyendo");
  if (!activas.length && !listos) return null;
  return (
    <div className="rounded-chico bg-superficie-2 px-3 py-2 text-sm">
      {activas.length > 0 && (
        <ul className="space-y-1">
          {activas.map((s) => (
            <li key={s.clave} className="flex items-baseline justify-between gap-3">
              <span className="truncate text-texto-2">{s.nombre}</span>
              <span
                className={`shrink-0 text-xs font-semibold ${s.estado === "error" ? "text-peligro" : "text-info"}`}
                role={s.estado === "error" ? "alert" : "status"}
              >
                {s.estado === "subiendo" ? "Subiendo…" : s.estado === "leyendo" ? "Leyendo…" : s.error}
              </span>
            </li>
          ))}
        </ul>
      )}
      {listos > 0 && !trabajando && (
        <p className="text-exito" role="status">
          {listos === 1 ? "1 archivo leído." : `${listos} archivos leídos.`} Revisa lo que falte en la tabla.
        </p>
      )}
    </div>
  );
}

/** Mientras se arrastran archivos sobre la ventana, toda la pantalla los recibe. */
export function ZonaArrastre({ onArchivos }: { onArchivos: (l: File[]) => void }) {
  const [encima, setEncima] = useState(false);
  const alSoltar = useRef(onArchivos);
  useEffect(() => {
    alSoltar.current = onArchivos;
  }, [onArchivos]);

  useEffect(() => {
    let profundidad = 0;
    const conArchivos = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const entra = (e: DragEvent) => {
      if (!conArchivos(e)) return;
      profundidad++;
      setEncima(true);
    };
    const sale = () => {
      profundidad = Math.max(0, profundidad - 1);
      if (!profundidad) setEncima(false);
    };
    const sobre = (e: DragEvent) => conArchivos(e) && e.preventDefault();
    const suelta = (e: DragEvent) => {
      if (!conArchivos(e)) return;
      e.preventDefault();
      profundidad = 0;
      setEncima(false);
      alSoltar.current([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener("dragenter", entra);
    window.addEventListener("dragleave", sale);
    window.addEventListener("dragover", sobre);
    window.addEventListener("drop", suelta);
    return () => {
      window.removeEventListener("dragenter", entra);
      window.removeEventListener("dragleave", sale);
      window.removeEventListener("dragover", sobre);
      window.removeEventListener("drop", suelta);
    };
  }, []);

  if (!encima) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-acento-texto/15 p-6">
      <div className="rounded-grande border-2 border-dashed border-acento bg-superficie px-10 py-8 text-center shadow-xl">
        <IconoSubir className="mx-auto h-8 w-8 text-acento-texto" />
        <p className="mt-2 font-display text-lg font-bold text-tinta">Suelta para subir</p>
        <p className="text-sm text-texto-2">Fotos o PDF: se leen solos.</p>
      </div>
    </div>
  );
}
