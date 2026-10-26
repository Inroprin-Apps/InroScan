"use client";

import Image from "next/image";
import { useState } from "react";
import { ruta } from "@/lib/base";
import { entrar, salir, useSesion, type Persona } from "@/lib/sesion";

export function Inicio() {
  const sesion = useSesion();

  if (sesion.estado === "cargando") {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-texto-3" role="status">Abriendo InroScan…</p>
      </main>
    );
  }
  if (sesion.estado === "fuera") return <Ingreso aviso={sesion.aviso} />;
  return <Dentro persona={sesion.persona} />;
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
          <p role="alert" className="mt-5 rounded-chico bg-peligro-suave px-4 py-3 text-sm text-peligro">
            {falla ?? aviso}
          </p>
        )}

        <button
          type="button"
          onClick={ir}
          disabled={yendo}
          className="mt-6 w-full rounded-chico bg-acento px-4 py-3 font-semibold text-white transition hover:bg-acento-texto disabled:opacity-60"
        >
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

function Dentro({ persona }: { persona: Persona }) {
  const [saliendo, setSaliendo] = useState(false);
  const nombre = persona.nombre || persona.correo;
  const primerNombre = (persona.nombre || persona.correo.split("@")[0]).split(/\s+/)[0];

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-borde bg-superficie px-4 py-3 sm:px-6">
        <Image src={ruta("inroprin-marca.svg")} alt="" width={28} height={28} />
        <span className="font-display font-bold text-tinta">InroScan</span>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <div className="min-w-0 text-right">
            <p className="truncate text-sm font-medium text-texto">{nombre}</p>
            {persona.es_administracion && (
              <p className="text-xs font-semibold text-acento-texto">Administración</p>
            )}
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

      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <h1 className="font-display text-2xl font-bold text-tinta">Hola, {primerNombre}</h1>
        <p className="mt-1 text-texto-2">Entraste como {persona.correo}.</p>

        <section className="mt-6 rounded-grande bg-superficie p-6 shadow-sm">
          <h2 className="font-display text-lg font-semibold text-tinta">Mis rendiciones</h2>
          <p className="mt-2 text-texto-2">
            Acá vas a ver tus memos de viáticos y las cajas chicas que administras, con cuánto
            llevas gastado de cada una. Es lo próximo que se construye.
          </p>
        </section>
      </main>
    </div>
  );
}
