"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ruta } from "@/lib/base";
import { entrar, salir, useSesion, type Persona } from "@/lib/sesion";
import { Aviso, botonPrincipal } from "./piezas";

/**
 * Toda página con datos pasa por acá: si no hay sesión muestra el ingreso, y
 * si la hay, la barra de arriba y el contenido con la persona ya resuelta.
 */
export function ConSesion({ children }: { children: (persona: Persona) => ReactNode }) {
  const sesion = useSesion();

  if (sesion.estado === "cargando") {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-texto-3" role="status">Abriendo InroScan…</p>
      </main>
    );
  }
  if (sesion.estado === "fuera") return <Ingreso aviso={sesion.aviso} />;

  return (
    <div className="flex flex-1 flex-col">
      <Barra persona={sesion.persona} />
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">{children(sesion.persona)}</main>
    </div>
  );
}

function Barra({ persona }: { persona: Persona }) {
  const [saliendo, setSaliendo] = useState(false);
  return (
    <header className="flex items-center gap-3 border-b border-borde bg-superficie px-4 py-3 sm:px-6">
      <Link href="/" className="flex items-center gap-2">
        <Image src={ruta("inroprin-marca.svg")} alt="" width={28} height={28} />
        <span className="font-display font-bold text-tinta">InroScan</span>
      </Link>
      <div className="ml-auto flex min-w-0 items-center gap-3">
        <div className="min-w-0 text-right">
          <p className="truncate text-sm font-medium text-texto">{persona.nombre || persona.correo}</p>
          {persona.es_administracion && <p className="text-xs font-semibold text-acento-texto">Administración</p>}
        </div>
        <button
          type="button"
          onClick={() => {
            setSaliendo(true);
            salir();
          }}
          disabled={saliendo}
          className="shrink-0 rounded-chico border border-borde-2 px-3 py-1.5 text-sm text-texto-2 hover:bg-superficie-2 disabled:opacity-60"
        >
          Salir
        </button>
      </div>
    </header>
  );
}

function Ingreso({ aviso }: { aviso: string | null }) {
  const [yendo, setYendo] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);

  const ir = async () => {
    setYendo(true);
    setFalla(null);
    const { error } = await entrar();
    // Si todo va bien el navegador ya se fue a Google y esto no se ve.
    if (error) {
      setFalla(`No se pudo abrir Google: ${error.message}`);
      setYendo(false);
    }
  };

  return (
    <main className="flex flex-1 items-center justify-center p-4 sm:p-6">
      <section className="w-full max-w-md rounded-grande bg-superficie p-6 shadow-sm sm:p-8">
        <Image src={ruta("inroprin.svg")} alt="INROPRIN" width={183} height={41} priority />
        <h1 className="mt-6 font-display text-2xl font-bold text-tinta">InroScan</h1>
        <p className="mt-2 text-texto-2">Rendiciones de caja chica y memos de viáticos.</p>

        {(aviso || falla) && (
          <div className="mt-5">
            <Aviso>{falla ?? aviso}</Aviso>
          </div>
        )}

        <button type="button" onClick={ir} disabled={yendo} className={`mt-6 w-full py-3 ${botonPrincipal}`}>
          {yendo ? "Abriendo Google…" : "Entrar con Google"}
        </button>
        <p className="mt-3 text-center text-sm text-texto-3">Solo cuentas @inroprin.com</p>

        <p className="mt-6 border-t border-borde pt-4 text-sm text-texto-2">
          La herramienta anterior sigue en{" "}
          {/* Fuera del basePath a propósito: es la app actual, no una ruta de esta. */}
          <a className="font-medium text-acento-texto underline" href="/inroscan/">
            /inroscan
          </a>
          .
        </p>
      </section>
    </main>
  );
}
