"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { ruta } from "@/lib/base";
import { cuentas } from "@/lib/cuentas";
import { useBarraContraida } from "@/lib/preferencias";
import { EN_CURSO, tituloRendicion, useRendiciones } from "@/lib/rendiciones";
import { entrar, salir, useSesion, type Persona } from "@/lib/sesion";
import {
  IconoBandeja,
  IconoCaja,
  IconoDerecha,
  IconoInicio,
  IconoIzquierda,
  IconoLista,
  IconoMas,
  IconoPersonas,
  IconoReportes,
  IconoSalir,
} from "./iconos";
import { NuevaRendicion } from "./nueva-rendicion";
import { Aviso, botonPrincipal } from "./piezas";

/** Qué está abierto, para marcarlo en la barra: una sección o el id de una rendición. */
export type Activo = "inicio" | "bandeja" | "cajas" | "catalogos" | "personas" | "reportes" | (string & {});

/**
 * Toda página con datos pasa por acá: si no hay sesión muestra el ingreso, y
 * si la hay, la barra lateral (en teléfono, la de abajo) y el contenido con
 * la persona ya resuelta.
 */
export function ConSesion({
  children,
  activo,
  contraida,
}: {
  children: (persona: Persona) => ReactNode;
  activo?: Activo;
  /** La pantalla necesita todo el ancho: la barra queda en íconos. */
  contraida?: boolean;
}) {
  const sesion = useSesion();

  if (sesion.estado === "cargando") {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-texto-3" role="status">
          Abriendo InroScan…
        </p>
      </main>
    );
  }
  if (sesion.estado === "fuera") return <Ingreso aviso={sesion.aviso} />;

  return (
    <Armazon persona={sesion.persona} activo={activo} forzarContraida={contraida}>
      {children(sesion.persona)}
    </Armazon>
  );
}

function Armazon({
  persona,
  activo,
  forzarContraida,
  children,
}: {
  persona: Persona;
  activo?: Activo;
  forzarContraida?: boolean;
  children: ReactNode;
}) {
  const [preferida, setPreferida] = useBarraContraida();
  const [nueva, setNueva] = useState(false);
  const cerrarNueva = useCallback(() => setNueva(false), []);
  const contraida = forzarContraida || preferida;

  return (
    <div className="flex min-h-dvh flex-1">
      <BarraLateral
        persona={persona}
        activo={activo}
        contraida={contraida}
        onAlternar={forzarContraida ? undefined : () => setPreferida(!preferida)}
        onNueva={() => setNueva(true)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <CabeceraMovil persona={persona} />
        <main className="min-w-0 flex-1 px-4 pb-28 pt-4 md:px-6 md:pb-8 md:pt-6">{children}</main>
      </div>
      <NavInferior persona={persona} activo={activo} onNueva={() => setNueva(true)} />
      {nueva && <NuevaRendicion persona={persona} onCerrar={cerrarNueva} />}
    </div>
  );
}

const ADMIN: { clave: Activo; texto: string; href: string; Icono: (p: { className?: string }) => ReactNode }[] = [
  { clave: "bandeja", texto: "Bandeja de revisión", href: "/bandeja/", Icono: IconoBandeja },
  { clave: "cajas", texto: "Cajas chicas", href: "/cajas/", Icono: IconoCaja },
  { clave: "catalogos", texto: "Catálogos", href: "/catalogos/", Icono: IconoLista },
  { clave: "personas", texto: "Personas", href: "/personas/", Icono: IconoPersonas },
  { clave: "reportes", texto: "Reportes", href: "/reportes/", Icono: IconoReportes },
];

const enlace = (activo: boolean) =>
  `flex min-h-10 items-center gap-2.5 rounded-chico px-2.5 text-sm transition ${
    activo ? "bg-acento-suave font-semibold text-acento-texto" : "font-medium text-texto-2 hover:bg-superficie-2"
  }`;

function BarraLateral({
  persona,
  activo,
  contraida,
  onAlternar,
  onNueva,
}: {
  persona: Persona;
  activo?: Activo;
  contraida: boolean;
  onAlternar?: () => void;
  onNueva: () => void;
}) {
  const { rendiciones } = useRendiciones();
  const mias = (rendiciones ?? []).filter(
    (r) => r.responsable_id === persona.id && (EN_CURSO as readonly string[]).includes(r.estado),
  );
  const porRevisar = (rendiciones ?? []).filter((r) => r.estado === "enviada").length;

  if (contraida) {
    return (
      <nav
        aria-label="Navegación principal"
        className="sticky top-0 hidden h-dvh w-16 shrink-0 flex-col items-center gap-2 border-r border-borde bg-superficie py-4 md:flex"
      >
        <Link href="/" aria-label="InroScan, inicio" className="mb-2">
          <Image src={ruta("inroprin-marca.svg")} alt="" width={28} height={28} />
        </Link>
        <button type="button" onClick={onNueva} aria-label="Nueva rendición" title="Nueva rendición" className="flex h-11 w-11 items-center justify-center rounded-chico bg-acento-texto text-white">
          <IconoMas />
        </button>
        <Link href="/" aria-label="Mis rendiciones" title="Mis rendiciones" className={`${enlace(activo === "inicio")} h-11 w-11 justify-center px-0`}>
          <IconoInicio />
        </Link>
        {persona.es_administracion &&
          ADMIN.map((a) => (
            <Link key={a.clave} href={a.href} aria-label={a.texto} title={a.texto} className={`${enlace(activo === a.clave)} h-11 w-11 justify-center px-0`}>
              <a.Icono />
            </Link>
          ))}
        {onAlternar && (
          <button type="button" onClick={onAlternar} aria-label="Expandir la barra" title="Expandir la barra" className="mt-auto flex h-11 w-11 items-center justify-center rounded-chico text-texto-2 hover:bg-superficie-2">
            <IconoDerecha />
          </button>
        )}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Navegación principal"
      className="sticky top-0 hidden h-dvh w-62 shrink-0 flex-col gap-5 overflow-y-auto border-r border-borde bg-superficie px-3.5 py-5 md:flex"
    >
      <div className="flex items-center gap-2.5 px-1.5">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src={ruta("inroprin-marca.svg")} alt="" width={28} height={28} />
          <span className="font-display text-lg font-bold text-tinta">InroScan</span>
        </Link>
        {onAlternar && (
          <button type="button" onClick={onAlternar} aria-label="Contraer la barra" title="Contraer la barra" className="ml-auto flex h-8 w-8 items-center justify-center rounded-chico text-texto-2 hover:bg-superficie-2">
            <IconoIzquierda className="h-4.5 w-4.5" />
          </button>
        )}
      </div>

      <button type="button" onClick={onNueva} className={`flex items-center justify-center gap-2 ${botonPrincipal}`}>
        <IconoMas className="h-4.5 w-4.5" />
        Nueva rendición
      </button>

      <Link href="/" className={enlace(activo === "inicio")}>
        <IconoInicio className="h-4.5 w-4.5" />
        Mis rendiciones
      </Link>

      {mias.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="px-2.5 text-[11px] font-bold uppercase tracking-wider text-texto-3">En curso</p>
          {mias.map((r) => {
            const c = cuentas(r.comprobantes, r.monto, r.no_sustentan ?? []);
            const observada = r.estado === "observada";
            return (
              <Link
                key={r.id}
                href={`/rendicion/?id=${r.id}`}
                className={`flex flex-col gap-1.5 rounded-chico px-2.5 py-2 text-[13px] ${
                  activo === r.id ? "bg-acento-suave font-semibold text-acento-texto" : "font-medium text-texto-2 hover:bg-superficie-2"
                }`}
              >
                <span className="flex justify-between gap-2">
                  <span className="truncate">{tituloRendicion(r)}</span>
                  <span className={`shrink-0 text-xs ${observada ? "font-bold text-peligro" : r.estado === "enviada" ? "text-aviso" : "text-texto-3"}`}>
                    {observada ? "Observada" : r.estado === "enviada" ? "Enviada" : `${c.consumo ?? 0} %`}
                  </span>
                </span>
                <span className="h-1 overflow-hidden rounded-full bg-borde">
                  <span
                    className={`block h-full ${observada ? "bg-peligro" : "bg-acento"}`}
                    style={{ width: `${Math.min(c.consumo ?? 0, 100)}%` }}
                  />
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {persona.es_administracion && (
        <div className="flex flex-col gap-0.5">
          <p className="mb-1 px-2.5 text-[11px] font-bold uppercase tracking-wider text-texto-3">Administración</p>
          {ADMIN.map((a) => (
            <Link key={a.clave} href={a.href} className={enlace(activo === a.clave)}>
              <a.Icono className="h-4.5 w-4.5" />
              {a.texto}
              {a.clave === "bandeja" && porRevisar > 0 && (
                <span className="ml-auto flex h-5.5 min-w-5.5 items-center justify-center rounded-full bg-aviso-suave px-1.5 text-xs font-bold text-aviso">
                  {porRevisar}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center gap-2.5 border-t border-borde px-1.5 pt-3.5">
        <Iniciales persona={persona} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-texto">{persona.nombre || persona.correo}</span>
          <span className="text-xs text-texto-3">{persona.es_administracion ? "Administración" : persona.correo}</span>
        </span>
        <BotonSalir />
      </div>
    </nav>
  );
}

function Iniciales({ persona }: { persona: Persona }) {
  const iniciales = (persona.nombre || persona.correo)
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span aria-hidden="true" className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full bg-acento-suave text-[13px] font-bold text-acento-texto">
      {iniciales}
    </span>
  );
}

function BotonSalir({ conTexto }: { conTexto?: boolean }) {
  const [saliendo, setSaliendo] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        setSaliendo(true);
        salir();
      }}
      disabled={saliendo}
      aria-label="Salir"
      title="Salir"
      className={
        conTexto
          ? "flex flex-col items-center gap-0.5 text-[11px] font-semibold text-texto-2"
          : "ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-chico border border-borde-2 text-texto-2 hover:bg-superficie-2 disabled:opacity-60"
      }
    >
      <IconoSalir className={conTexto ? "h-5.5 w-5.5" : "h-4 w-4"} />
      {conTexto && "Salir"}
    </button>
  );
}

function CabeceraMovil({ persona }: { persona: Persona }) {
  return (
    <header className="flex items-center gap-2.5 border-b border-borde bg-superficie px-4 py-3 md:hidden">
      <Link href="/" className="flex items-center gap-2">
        <Image src={ruta("inroprin-marca.svg")} alt="" width={26} height={26} />
        <span className="font-display font-bold text-tinta">InroScan</span>
      </Link>
      <span className="ml-auto truncate text-sm text-texto-2">{persona.nombre || persona.correo}</span>
    </header>
  );
}

function NavInferior({ persona, activo, onNueva }: { persona: Persona; activo?: Activo; onNueva: () => void }) {
  const item = (on: boolean) =>
    `flex min-w-16 flex-col items-center gap-0.5 text-[11px] font-semibold ${on ? "text-acento-texto" : "text-texto-2"}`;
  return (
    <nav
      aria-label="Navegación"
      className="fixed inset-x-0 bottom-0 z-30 flex h-17 items-center justify-around border-t border-borde bg-superficie pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <Link href="/" className={item(activo === "inicio")}>
        <IconoInicio className="h-5.5 w-5.5" />
        Rendiciones
      </Link>
      <button type="button" onClick={onNueva} className={item(false)}>
        <IconoMas className="h-5.5 w-5.5" />
        Nueva
      </button>
      {persona.es_administracion && (
        <Link href="/bandeja/" className={item(activo === "bandeja")}>
          <IconoBandeja className="h-5.5 w-5.5" />
          Bandeja
        </Link>
      )}
      <BotonSalir conTexto />
    </nav>
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
