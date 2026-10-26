"use client";

import type { ReactNode } from "react";
import { soles } from "@/lib/cuentas";
import type { EstadoRendicion } from "@/lib/tipos";

const ESTADOS: Record<EstadoRendicion, { texto: string; clase: string }> = {
  abierta: { texto: "En curso", clase: "bg-info-suave text-info" },
  enviada: { texto: "Enviada a administración", clase: "bg-aviso-suave text-aviso" },
  observada: { texto: "Observada", clase: "bg-peligro-suave text-peligro" },
  aprobada: { texto: "Aprobada", clase: "bg-exito-suave text-exito" },
  repuesta: { texto: "Repuesta", clase: "bg-exito-suave text-exito" },
  liquidada: { texto: "Liquidada", clase: "bg-exito-suave text-exito" },
};

export function Estado({ estado }: { estado: EstadoRendicion }) {
  const e = ESTADOS[estado];
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${e.clase}`}>
      {e.texto}
    </span>
  );
}

/** Cuánto del monto se gastó. Pasado el 100 % se marca: hay reembolso. */
export function BarraConsumo({ gastado, monto, consumo }: { gastado: number; monto: number; consumo: number | null }) {
  const pasado = consumo != null && consumo > 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-texto-2">
          <b className="text-texto">{soles(gastado)}</b> de {soles(monto)}
        </span>
        <span className={`font-semibold ${pasado ? "text-peligro" : "text-texto-2"}`}>
          {consumo == null ? "—" : `${consumo}%`}
        </span>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-superficie-2"
        role="progressbar"
        aria-label="Gastado del monto"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(consumo ?? 0, 100)}
      >
        <div
          className={`h-full rounded-full ${pasado ? "bg-peligro" : "bg-acento"}`}
          style={{ width: `${Math.min(consumo ?? 0, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function Aviso({ tono = "peligro", children }: { tono?: "peligro" | "aviso" | "info"; children: ReactNode }) {
  const clases = {
    peligro: "bg-peligro-suave text-peligro",
    aviso: "bg-aviso-suave text-aviso",
    info: "bg-info-suave text-info",
  }[tono];
  return (
    <p role="alert" className={`rounded-chico px-4 py-3 text-sm ${clases}`}>
      {children}
    </p>
  );
}

export function Tarjeta({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-grande bg-superficie p-4 shadow-sm sm:p-6 ${className}`}>{children}</section>;
}

export const botonPrincipal =
  "rounded-chico bg-acento px-4 py-2.5 font-semibold text-white transition hover:bg-acento-texto disabled:cursor-not-allowed disabled:opacity-50";
export const botonSecundario =
  "rounded-chico border border-borde-2 bg-superficie px-4 py-2.5 font-medium text-texto-2 transition hover:bg-superficie-2 disabled:cursor-not-allowed disabled:opacity-50";
export const campo =
  "w-full rounded-chico border border-borde-2 bg-superficie px-3 py-2 text-texto outline-none focus:border-acento focus:ring-2 focus:ring-acento-suave disabled:bg-superficie-2 disabled:text-texto-2";
