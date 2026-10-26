"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCatalogos } from "@/lib/catalogos";
import { faltan, herencia } from "@/lib/comprobante";
import { cuentas } from "@/lib/cuentas";
import {
  agregarComprobante,
  cambiarComprobante,
  cambiarComprobantes,
  cambiarRendicion,
  enviar,
  leerRendicion,
  leerRepetidos,
  type CambiosComprobante,
  type DatosRendicion,
} from "@/lib/datos";
import { descargarExcel, filasDeHoja } from "@/lib/hoja-excel";
import { recargarRendiciones, tituloRendicion } from "@/lib/rendiciones";
import type { Persona } from "@/lib/sesion";
import { leer } from "@/lib/subida";
import { EDITABLE, type Archivo } from "@/lib/tipos";
import { IconoBajar, IconoReloj } from "../iconos";
import { ConSesion } from "../marco";
import { Aviso, botonPrincipal, botonSecundario } from "../piezas";
import { Cabecera, Resumen } from "./cabecera";
import { Hoja } from "./hoja";
import { Historial } from "./historial";
import { BotonesSubida, ListaSubidas, ZonaArrastre, useSubidas } from "./subidas";

export function VistaRendicion() {
  const id = useSearchParams().get("id");
  return (
    <ConSesion activo={id ?? undefined}>
      {(persona) =>
        id ? <HojaRendicion id={id} persona={persona} /> : <Aviso>Falta indicar qué rendición abrir.</Aviso>
      }
    </ConSesion>
  );
}

export const leyendo = (a: Archivo) => a.estado_lectura === "pendiente" || a.estado_lectura === "procesando";

/** La rendición y sus comprobantes, con todo lo que se puede hacer sobre ellos. */
export function useRendicion(id: string, persona: Persona) {
  const [datos, setDatos] = useState<DatosRendicion | null>(null);
  const [repetidos, setRepetidos] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  // Sube cuando un guardado falla: las celdas se rearman con el valor que
  // quedó en la base en vez de seguir mostrando el que se rechazó.
  const [intento, setIntento] = useState(0);
  const datosActuales = useRef(datos);
  useEffect(() => {
    datosActuales.current = datos;
  }, [datos]);
  // Archivos cuya lectura ya pidió esta pantalla: no se piden dos veces.
  const pedidos = useRef(new Set<string>());

  const cargar = useCallback(async () => {
    try {
      const [d, rep] = await Promise.all([leerRendicion(id), leerRepetidos(id).catch(() => new Map<string, string>())]);
      setDatos(d);
      setRepetidos(rep);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar();
  }, [cargar]);

  const pedirLectura = useCallback(
    async (archivoId: string) => {
      pedidos.current.add(archivoId);
      try {
        await leer(archivoId);
      } finally {
        await cargar();
      }
    },
    [cargar],
  );

  // Lo que quedó subido pero sin leer (se cerró la pestaña, se cortó la señal
  // o se capturó en otro equipo) se lee al abrir la rendición.
  const editable = !!datos && datos.rendicion.responsable_id === persona.id && EDITABLE.includes(datos.rendicion.estado);
  useEffect(() => {
    if (!datos || !editable) return;
    for (const a of datos.archivos) {
      if (a.estado_lectura === "pendiente" && !pedidos.current.has(a.id)) pedirLectura(a.id).catch(() => {});
    }
  }, [datos, editable, pedirLectura]);

  // Mientras el servidor lee algo, se vuelve a mirar cada pocos segundos: la
  // lectura pudo pedirla otra pestaña u otro equipo.
  const hayLectura = !!datos?.archivos.some(leyendo);
  useEffect(() => {
    if (!hayLectura) return;
    const t = setInterval(cargar, 4000);
    return () => clearInterval(t);
  }, [hayLectura, cargar]);

  const ejecutar = async (accion: () => Promise<void>) => {
    setError(null);
    try {
      await accion();
      // La barra lateral y el inicio muestran el avance: que se enteren.
      recargarRendiciones();
    } catch (e) {
      setError((e as Error).message);
      setIntento((n) => n + 1);
    }
  };

  const reemplazar = (nuevas: DatosRendicion["comprobantes"]) =>
    setDatos((d) => d && { ...d, comprobantes: d.comprobantes.map((x) => nuevas.find((n) => n.id === x.id) ?? x) });
  const conRendicion = (nueva: Partial<DatosRendicion["rendicion"]>) =>
    setDatos((d) => d && { ...d, rendicion: { ...d.rendicion, ...nueva } });

  const acciones = {
    guardarFila: (fila: string, cambios: CambiosComprobante) =>
      ejecutar(async () => reemplazar([await cambiarComprobante(fila, cambios)])),
    guardarVarios: (ids: string[], cambios: CambiosComprobante) =>
      ejecutar(async () => reemplazar(await cambiarComprobantes(ids, cambios))),
    guardarRendicion: (cambios: Parameters<typeof cambiarRendicion>[1]) =>
      ejecutar(async () => conRendicion(await cambiarRendicion(id, cambios))),
    agregar: () =>
      ejecutar(async () => {
        const d = datosActuales.current;
        if (!d) return;
        const nueva = await agregarComprobante(id, herencia(d.comprobantes, d.rendicion.tipo, persona));
        setDatos((x) => x && { ...x, comprobantes: [...x.comprobantes, nueva] });
      }),
    enviar: () => ejecutar(async () => conRendicion(await enviar(id))),
    releer: (archivoId: string) =>
      ejecutar(async () => {
        setDatos((d) => d && { ...d, archivos: d.archivos.map((a) => (a.id === archivoId ? { ...a, estado_lectura: "procesando" } : a)) });
        await pedirLectura(archivoId);
      }),
  };

  return { datos, repetidos, error, intento, editable, cargar, acciones, datosActuales, pedidos, conRendicion, ejecutar };
}

function HojaRendicion({ id, persona }: { id: string; persona: Persona }) {
  const { catalogos, error: errorCatalogos } = useCatalogos();
  const { datos, repetidos, error, intento, editable, cargar, acciones, datosActuales, pedidos } = useRendicion(id, persona);
  const [verHistorial, setVerHistorial] = useState(false);
  const cerrarHistorial = useCallback(() => setVerHistorial(false), []);

  const { subidas, recibir } = useSubidas({
    obtener: () => datosActuales.current?.rendicion ?? null,
    persona,
    filasActuales: () => datosActuales.current?.comprobantes ?? [],
    recargar: cargar,
    alPedirLectura: (a) => pedidos.current.add(a),
  });

  if (error && !datos) return <Aviso>{error}</Aviso>;
  if (errorCatalogos) return <Aviso>{errorCatalogos}</Aviso>;
  if (!datos || !catalogos) {
    return (
      <p className="text-texto-3" role="status">
        Cargando…
      </p>
    );
  }

  const { rendicion: r, caja, comprobantes, archivos } = datos;
  const c = cuentas(comprobantes, r.monto, r.no_sustentan ?? []);
  const incompletas = comprobantes.filter((x) => faltan(x).length > 0).length;
  const porLeer = archivos.filter(leyendo).length;
  const responsable = r.responsable?.nombre || r.responsable?.correo || "—";
  const motivo =
    porLeer > 0
      ? `Leyendo ${porLeer} archivo${porLeer === 1 ? "" : "s"}…`
      : c.comprobantes === 0
        ? "Sube al menos un comprobante para poder enviar."
        : incompletas > 0
          ? `Faltan datos en ${incompletas} comprobante${incompletas === 1 ? "" : "s"}.`
          : null;

  const mandar = () => {
    const texto = `¿Enviar a administración${r.version > 0 ? ` como versión ${r.version + 1}` : ""}? Mientras la revisan no vas a poder editarla.`;
    if (window.confirm(texto)) acciones.enviar();
  };

  const excel = () =>
    descargarExcel(
      tituloRendicion({ ...r, caja }).replace(" · ", " - "),
      filasDeHoja({ rendicion: r, caja, administrador: responsable, comprobantes, catalogos }),
    );

  return (
    <div className="space-y-4">
      {editable && <ZonaArrastre onArchivos={recibir} />}

      <Cabecera
        r={r}
        caja={caja}
        acciones={
          <>
            {comprobantes.length > 0 && (
              <Link href={`/rendicion/revisar/?id=${r.id}`} className={`${botonSecundario} text-sm`}>
                Revisar con imagen
              </Link>
            )}
            <button type="button" onClick={() => setVerHistorial(true)} className={`flex items-center gap-2 text-sm ${botonSecundario}`}>
              <IconoReloj className="h-4 w-4" />
              Historial
            </button>
            {comprobantes.length > 0 && (
              <button type="button" onClick={excel} className={`flex items-center gap-2 text-sm ${botonSecundario}`}>
                <IconoBajar className="h-4 w-4" />
                Excel
              </button>
            )}
            {editable && (
              <button type="button" onClick={mandar} disabled={!!motivo} title={motivo ?? undefined} className={`text-sm ${botonPrincipal}`}>
                Enviar a administración
              </button>
            )}
          </>
        }
      />

      {r.estado === "observada" && r.observacion && (
        <Aviso tono="aviso">
          <b>Observación de administración:</b> {r.observacion}
        </Aviso>
      )}
      {r.estado === "enviada" && (
        <Aviso tono="info">Enviada a administración (versión {r.version}). No se puede editar mientras la revisan.</Aviso>
      )}
      {editable && motivo && c.comprobantes > 0 && <p className="text-[13px] text-texto-2">Para enviar: {motivo}</p>}

      <Resumen
        r={r}
        caja={caja}
        responsable={responsable}
        catalogos={catalogos}
        c={c}
        editable={editable}
        intento={intento}
        onGuardar={acciones.guardarRendicion}
      />

      {error && <Aviso>{error}</Aviso>}
      <ListaSubidas subidas={subidas} />

      <Hoja
        rendicionId={r.id}
        filas={comprobantes}
        archivos={archivos}
        repetidos={repetidos}
        catalogos={catalogos}
        editable={editable}
        intento={intento}
        onGuardar={acciones.guardarFila}
        onGuardarVarios={acciones.guardarVarios}
        onReleer={acciones.releer}
        herramientas={
          editable && (
            <>
              <button type="button" onClick={acciones.agregar} className="h-10 px-2 text-sm font-medium text-texto-2 underline">
                Agregar a mano
              </button>
              <BotonesSubida onArchivos={recibir} />
            </>
          )
        }
      />

      {verHistorial && (
        <Historial rendicionId={r.id} persona={persona} filas={comprobantes} catalogos={catalogos} onCerrar={cerrarHistorial} />
      )}
    </div>
  );
}
