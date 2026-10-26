"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useCatalogos } from "@/lib/catalogos";
import { faltan, numeroCompleto, partirNumero } from "@/lib/comprobante";
import { aNumero, cuentas, soles } from "@/lib/cuentas";
import {
  agregarComprobante,
  cambiarComprobante,
  cambiarRendicion,
  enviar,
  leerRendicion,
  type CambiosComprobante,
} from "@/lib/datos";
import type { Persona } from "@/lib/sesion";
import { EDITABLE, type Caja, type Catalogos, type Comprobante, type Rendicion } from "@/lib/tipos";
import { ConSesion } from "../marco";
import { tituloRendicion } from "../mis-rendiciones";
import { Aviso, BarraConsumo, Estado, Tarjeta, botonPrincipal, botonSecundario, campo } from "../piezas";

export function VistaRendicion() {
  const id = useSearchParams().get("id");
  return (
    <ConSesion>
      {(persona) =>
        id ? <HojaRendicion id={id} persona={persona} /> : <Aviso>Falta indicar qué rendición abrir.</Aviso>
      }
    </ConSesion>
  );
}

type Datos = { rendicion: Rendicion; caja: Caja | null; comprobantes: Comprobante[] };

function HojaRendicion({ id, persona }: { id: string; persona: Persona }) {
  const { catalogos, error: errorCatalogos } = useCatalogos();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Sube cuando un guardado falla: las celdas se rearman con el valor que
  // quedó en la base en vez de seguir mostrando el que se rechazó.
  const [intento, setIntento] = useState(0);

  const cargar = useCallback(async () => {
    try {
      setDatos(await leerRendicion(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar();
  }, [cargar]);

  if (error && !datos) return <Aviso>{error}</Aviso>;
  if (errorCatalogos) return <Aviso>{errorCatalogos}</Aviso>;
  if (!datos || !catalogos) return <p className="text-texto-3" role="status">Cargando…</p>;

  const { rendicion: r, caja, comprobantes } = datos;
  const editable = r.responsable_id === persona.id && EDITABLE.includes(r.estado);
  const c = cuentas(comprobantes, r.monto, r.no_sustentan ?? []);
  const incompletas = comprobantes.filter((x) => faltan(x).length > 0).length;

  const ejecutar = async (accion: () => Promise<void>) => {
    setError(null);
    setAviso(null);
    try {
      await accion();
    } catch (e) {
      setError((e as Error).message);
      setIntento((n) => n + 1);
    }
  };

  const guardarFila = (fila: string, cambios: CambiosComprobante) =>
    ejecutar(async () => {
      const nueva = await cambiarComprobante(fila, cambios);
      setDatos((d) => d && { ...d, comprobantes: d.comprobantes.map((x) => (x.id === fila ? nueva : x)) });
    });

  const guardarRendicion = (cambios: Parameters<typeof cambiarRendicion>[1]) =>
    ejecutar(async () => {
      const nueva = await cambiarRendicion(r.id, cambios);
      setDatos((d) => d && { ...d, rendicion: nueva });
    });

  const agregar = () =>
    ejecutar(async () => {
      // En un memo, quien gasta es quien rinde: área y solicitante salen solos.
      const nueva = await agregarComprobante(
        r.id,
        r.tipo === "memo" ? { area_id: persona.area_id, solicitante: persona.nombre } : {},
      );
      setDatos((d) => d && { ...d, comprobantes: [...d.comprobantes, nueva] });
    });

  const mandar = () => {
    if (!window.confirm("¿Enviar a administración? Mientras la revisan no vas a poder editarla.")) return;
    ejecutar(async () => {
      const nueva = await enviar(r.id);
      setDatos((d) => d && { ...d, rendicion: nueva });
      setAviso("Enviada. Administración la va a revisar; si observa algo, vuelve a quedar editable.");
    });
  };

  return (
    <div className="space-y-5">
      <Link href="/" className="text-sm font-medium text-acento-texto">
        ← Mis rendiciones
      </Link>

      <Cabecera r={r} caja={caja} persona={persona} catalogos={catalogos} editable={editable} intento={intento} onGuardar={guardarRendicion} />

      {r.estado === "observada" && r.observacion && (
        <Aviso tono="aviso">
          <b>Observación de administración:</b> {r.observacion}
        </Aviso>
      )}
      {!editable && r.estado === "enviada" && (
        <Aviso tono="info">Enviada a administración. No se puede editar mientras la revisan.</Aviso>
      )}

      <Tarjeta>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Cifra etiqueta={r.tipo === "caja" ? "Fondo" : "Recibido"} valor={soles(r.monto)} />
          <Cifra etiqueta="Gastado" valor={soles(c.gastado)} />
          <Cifra etiqueta="Sustentado" valor={soles(c.sustentado)} />
          <Cifra
            etiqueta={c.saldo < 0 ? "A reembolsar" : r.tipo === "caja" ? "Queda en caja" : "Por devolver"}
            valor={soles(Math.abs(c.saldo))}
            tono={c.saldo < 0 ? "text-peligro" : undefined}
          />
        </div>
        <div className="mt-4">
          <BarraConsumo gastado={c.gastado} monto={aNumero(r.monto)} consumo={c.consumo} />
        </div>
        {c.porTipo.length > 0 && (
          <Sustento r={r} porTipo={c.porTipo} catalogos={catalogos} editable={editable} onGuardar={guardarRendicion} />
        )}
      </Tarjeta>

      {error && <Aviso>{error}</Aviso>}
      {aviso && <Aviso tono="info">{aviso}</Aviso>}

      <Tarjeta>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-tinta">Comprobantes</h2>
          {editable && (
            <button type="button" onClick={agregar} className={botonSecundario}>
              + Agregar comprobante
            </button>
          )}
        </div>
        {comprobantes.length === 0 ? (
          <p className="text-texto-2">
            {editable ? "Todavía no hay comprobantes. Agrega el primero." : "Esta rendición no tiene comprobantes."}
          </p>
        ) : (
          <Comprobantes
            filas={comprobantes}
            catalogos={catalogos}
            editable={editable}
            intento={intento}
            onGuardar={guardarFila}
          />
        )}
      </Tarjeta>

      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={mandar}
            className={botonPrincipal}
            disabled={c.comprobantes === 0 || incompletas > 0}
          >
            Enviar a administración
          </button>
          <span className="text-sm text-texto-2">
            {c.comprobantes === 0
              ? "Agrega al menos un comprobante para poder enviar."
              : incompletas > 0
                ? `Faltan datos en ${incompletas} comprobante${incompletas === 1 ? "" : "s"}.`
                : r.version > 0
                  ? `Se enviará como versión ${r.version + 1}.`
                  : "Revisa antes de enviar: después ya no se edita."}
          </span>
        </div>
      )}
    </div>
  );
}

function Cifra({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-texto-3">{etiqueta}</p>
      <p className={`mt-1 font-display text-xl font-bold ${tono ?? "text-tinta"}`}>{valor}</p>
    </div>
  );
}

function Cabecera({
  r,
  caja,
  persona,
  catalogos,
  editable,
  intento,
  onGuardar,
}: {
  r: Rendicion;
  caja: Caja | null;
  persona: Persona;
  catalogos: Catalogos;
  editable: boolean;
  intento: number;
  onGuardar: (cambios: Parameters<typeof cambiarRendicion>[1]) => void;
}) {
  const empresa = catalogos.empresas.find((e) => e.id === r.empresa_id)?.nombre ?? "—";
  const responsable = r.responsable_id === persona.id ? persona.nombre || persona.correo : "—";
  const k = (campo: string, valor: unknown) => `${campo}-${String(valor)}-${intento}`;

  return (
    <Tarjeta>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-tinta">{tituloRendicion(r, caja)}</h1>
          {r.version > 0 && <p className="mt-1 text-sm text-texto-3">Versión {r.version}</p>}
        </div>
        <Estado estado={r.estado} />
      </div>
      {/* Las cuatro primeras columnas de la hoja final salen de acá. */}
      <dl className="mt-5 grid gap-4 sm:grid-cols-4">
        <Dato etiqueta={r.tipo === "caja" ? "N° de caja" : "N° de memo"}>
          {r.tipo === "memo" && editable ? (
            <Texto key={k("memo", r.numero_memo)} valor={r.numero_memo ?? ""} etiqueta="N° de memo" onGuardar={(v) => v && onGuardar({ numero_memo: v })} />
          ) : (
            (r.tipo === "caja" ? caja?.numero : r.numero_memo) ?? "—"
          )}
        </Dato>
        <Dato etiqueta="Fecha de solicitud">
          {editable ? (
            <input
              key={k("fecha", r.fecha_solicitud)}
              type="date"
              aria-label="Fecha de solicitud"
              className={campo}
              defaultValue={r.fecha_solicitud}
              onBlur={(e) => e.target.value && e.target.value !== r.fecha_solicitud && onGuardar({ fecha_solicitud: e.target.value })}
            />
          ) : (
            new Date(`${r.fecha_solicitud}T00:00`).toLocaleDateString("es-PE")
          )}
        </Dato>
        <Dato etiqueta="Empresa">{empresa}</Dato>
        <Dato etiqueta={r.tipo === "caja" ? "Administrador de caja" : "Responsable"}>{responsable}</Dato>
        {r.tipo === "memo" && editable && (
          <Dato etiqueta="Monto recibido">
            <Texto
              key={k("monto", r.monto)}
              valor={String(aNumero(r.monto).toFixed(2))}
              etiqueta="Monto recibido"
              inputMode="decimal"
              onGuardar={(v) => {
                const n = aNumero(v);
                if (n > 0) onGuardar({ monto: n });
              }}
            />
          </Dato>
        )}
      </dl>
    </Tarjeta>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-texto-3">{etiqueta}</dt>
      <dd className="mt-1 text-texto">{children}</dd>
    </div>
  );
}

/** Qué tipos de comprobante suman al sustento en esta rendición. La DJ arranca fuera. */
function Sustento({
  r,
  porTipo,
  catalogos,
  editable,
  onGuardar,
}: {
  r: Rendicion;
  porTipo: ReturnType<typeof cuentas>["porTipo"];
  catalogos: Catalogos;
  editable: boolean;
  onGuardar: (cambios: { no_sustentan: string[] }) => void;
}) {
  const fuera = new Set(r.no_sustentan ?? []);
  const nombre = (id: string) => catalogos.tipos.find((t) => t.id === id)?.nombre ?? "Sin tipo";
  return (
    <div className="mt-5 border-t border-borde pt-4">
      <p className="text-sm font-medium text-texto-2">Qué sustenta</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {porTipo.map((t) => {
          const sinTipo = t.tipo === "SIN_TIPO";
          const cuenta = !sinTipo && !fuera.has(t.tipo);
          return (
            <button
              key={t.tipo}
              type="button"
              aria-pressed={cuenta}
              disabled={!editable || sinTipo}
              onClick={() =>
                onGuardar({ no_sustentan: cuenta ? [...fuera, t.tipo] : [...fuera].filter((x) => x !== t.tipo) })
              }
              className={`rounded-full border px-3 py-1 text-sm transition disabled:cursor-default ${
                cuenta ? "border-acento bg-acento-suave text-acento-texto" : "border-borde-2 text-texto-3 line-through"
              }`}
            >
              {nombre(t.tipo)} · {t.cuantos} · {soles(t.importe)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Un campo de texto que guarda al salir, y solo si cambió. */
function Texto({
  valor,
  etiqueta,
  onGuardar,
  disabled,
  inputMode,
  placeholder,
}: {
  valor: string;
  etiqueta: string;
  onGuardar: (v: string) => void;
  disabled?: boolean;
  inputMode?: "decimal" | "numeric" | "text";
  placeholder?: string;
}) {
  return (
    <input
      aria-label={etiqueta}
      className={campo}
      defaultValue={valor}
      disabled={disabled}
      inputMode={inputMode}
      placeholder={placeholder}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v !== valor) onGuardar(v);
      }}
    />
  );
}

function Lista({
  valor,
  etiqueta,
  opciones,
  onGuardar,
  disabled,
}: {
  valor: string | number | null;
  etiqueta: string;
  opciones: { id: string | number; nombre: string; activo: boolean }[];
  onGuardar: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label={etiqueta}
      className={campo}
      value={valor ?? ""}
      disabled={disabled}
      onChange={(e) => onGuardar(e.target.value)}
    >
      <option value="">—</option>
      {/* Lo desactivado no se ofrece, salvo que esta fila ya lo use. */}
      {opciones
        .filter((o) => o.activo || String(o.id) === String(valor))
        .map((o) => (
          <option key={o.id} value={o.id}>
            {o.nombre}
          </option>
        ))}
    </select>
  );
}

type Columna = { etiqueta: string; ancho: string; celda: (c: Comprobante, editable: boolean) => ReactNode };

function Comprobantes({
  filas,
  catalogos,
  editable,
  intento,
  onGuardar,
}: {
  filas: Comprobante[];
  catalogos: Catalogos;
  editable: boolean;
  intento: number;
  onGuardar: (id: string, cambios: CambiosComprobante) => void;
}) {
  // Cada celda se rearma cuando cambia su valor en la base o falla un guardado.
  const k = (c: Comprobante, campo: string, valor: unknown) => `${c.id}-${campo}-${String(valor)}-${intento}`;
  const num = (v: string) => (v ? Number(v) : null);

  const columnas: Columna[] = [
    {
      etiqueta: "Fecha",
      ancho: "w-36",
      celda: (c, e) => (
        <input
          key={k(c, "fecha", c.fecha)}
          type="date"
          aria-label="Fecha"
          className={campo}
          defaultValue={c.fecha ?? ""}
          disabled={!e}
          onBlur={(ev) => ev.target.value !== (c.fecha ?? "") && onGuardar(c.id, { fecha: ev.target.value || null })}
        />
      ),
    },
    {
      etiqueta: "Tipo",
      ancho: "w-44",
      celda: (c, e) => (
        <Lista
          valor={c.tipo_comprobante_id}
          etiqueta="Tipo de comprobante"
          opciones={catalogos.tipos}
          disabled={!e}
          onGuardar={(v) => onGuardar(c.id, { tipo_comprobante_id: v || null })}
        />
      ),
    },
    {
      etiqueta: "N° comprobante",
      ancho: "w-36",
      celda: (c, e) => (
        <Texto
          key={k(c, "numero", numeroCompleto(c))}
          valor={numeroCompleto(c)}
          etiqueta="N° de comprobante"
          placeholder="F001-6384"
          disabled={!e}
          onGuardar={(v) => onGuardar(c.id, partirNumero(v))}
        />
      ),
    },
    {
      etiqueta: "RUC",
      ancho: "w-32",
      celda: (c, e) => (
        <Texto key={k(c, "ruc", c.ruc)} valor={c.ruc} etiqueta="RUC" inputMode="numeric" disabled={!e} onGuardar={(v) => onGuardar(c.id, { ruc: v })} />
      ),
    },
    {
      etiqueta: "Proveedor",
      ancho: "w-48",
      celda: (c, e) => (
        <Texto key={k(c, "proveedor", c.proveedor)} valor={c.proveedor} etiqueta="Proveedor" disabled={!e} onGuardar={(v) => onGuardar(c.id, { proveedor: v })} />
      ),
    },
    {
      etiqueta: "Proyecto",
      ancho: "w-48",
      celda: (c, e) => (
        <Lista valor={c.proyecto_id} etiqueta="Proyecto" opciones={catalogos.proyectos} disabled={!e} onGuardar={(v) => onGuardar(c.id, { proyecto_id: num(v) })} />
      ),
    },
    {
      etiqueta: "Área del solicitante",
      ancho: "w-48",
      celda: (c, e) => (
        <Lista valor={c.area_id} etiqueta="Área del solicitante" opciones={catalogos.areas} disabled={!e} onGuardar={(v) => onGuardar(c.id, { area_id: num(v) })} />
      ),
    },
    {
      etiqueta: "Solicitante",
      ancho: "w-40",
      celda: (c, e) => (
        <Texto key={k(c, "solicitante", c.solicitante)} valor={c.solicitante} etiqueta="Solicitante" disabled={!e} onGuardar={(v) => onGuardar(c.id, { solicitante: v })} />
      ),
    },
    {
      etiqueta: "Concepto",
      ancho: "w-52",
      celda: (c, e) => (
        <Lista valor={c.concepto_id} etiqueta="Concepto" opciones={catalogos.conceptos} disabled={!e} onGuardar={(v) => onGuardar(c.id, { concepto_id: num(v) })} />
      ),
    },
    {
      etiqueta: "Descripción · motivo del gasto",
      ancho: "w-56",
      celda: (c, e) => (
        <Texto key={k(c, "descripcion", c.descripcion)} valor={c.descripcion} etiqueta="Descripción" disabled={!e} onGuardar={(v) => onGuardar(c.id, { descripcion: v })} />
      ),
    },
    {
      etiqueta: "Total inc. IGV",
      ancho: "w-28",
      celda: (c, e) => (
        <Texto
          key={k(c, "total", c.total)}
          valor={c.total == null ? "" : aNumero(c.total).toFixed(2)}
          etiqueta="Total"
          inputMode="decimal"
          placeholder="0.00"
          disabled={!e}
          onGuardar={(v) => onGuardar(c.id, { total: v === "" ? null : aNumero(v) })}
        />
      ),
    },
  ];

  const pie = (c: Comprobante) => {
    const f = faltan(c);
    return (
      <div className="flex flex-wrap items-center gap-2">
        {c.descartado ? (
          <span className="text-xs font-semibold text-texto-3">Descartado</span>
        ) : f.length > 0 ? (
          <span className="text-xs font-semibold text-aviso">Falta {f.join(", ")}</span>
        ) : null}
        {c.observacion && <span className="text-xs font-semibold text-peligro">Obs.: {c.observacion}</span>}
        {editable && (
          <button
            type="button"
            className="text-xs font-medium text-texto-2 underline"
            onClick={() => onGuardar(c.id, { descartado: !c.descartado })}
          >
            {c.descartado ? "Recuperar" : "Descartar"}
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      {/* PC: la hoja tal cual, con desplazamiento lateral si no entra. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-max border-separate border-spacing-x-1 border-spacing-y-1 text-sm">
          <thead>
            <tr>
              {columnas.map((col) => (
                <th key={col.etiqueta} scope="col" className={`${col.ancho} px-1 text-left text-xs font-semibold uppercase tracking-wide text-texto-3`}>
                  {col.etiqueta}
                </th>
              ))}
              <th scope="col" className="w-40" />
            </tr>
          </thead>
          <tbody>
            {filas.map((c) => (
              <tr key={c.id} className={c.descartado ? "opacity-50" : ""}>
                {columnas.map((col) => (
                  <td key={col.etiqueta} className="align-top">
                    {col.celda(c, editable && !c.descartado)}
                  </td>
                ))}
                <td className="px-1 align-middle">{pie(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Teléfono: una tarjeta por comprobante, sin arrastrar de lado. */}
      <ul className="space-y-3 md:hidden">
        {filas.map((c) => (
          <li key={c.id} className={`rounded-medio border border-borde p-3 ${c.descartado ? "opacity-50" : ""}`}>
            <div className="grid grid-cols-2 gap-3">
              {columnas.map((col) => (
                <label key={col.etiqueta} className="block text-xs font-semibold uppercase tracking-wide text-texto-3">
                  {col.etiqueta}
                  <div className="mt-1 font-normal normal-case tracking-normal">{col.celda(c, editable && !c.descartado)}</div>
                </label>
              ))}
            </div>
            <div className="mt-3">{pie(c)}</div>
          </li>
        ))}
      </ul>
    </>
  );
}
