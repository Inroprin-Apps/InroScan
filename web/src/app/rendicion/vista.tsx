"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useCatalogos } from "@/lib/catalogos";
import { faltan, herencia, numeroCompleto, partirNumero } from "@/lib/comprobante";
import { aNumero, cuentas, soles } from "@/lib/cuentas";
import {
  agregarComprobante,
  cambiarComprobante,
  cambiarRendicion,
  enviar,
  leerRendicion,
  type CambiosComprobante,
  type DatosRendicion,
} from "@/lib/datos";
import type { Persona } from "@/lib/sesion";
import { enlacesDeArchivos, leer, subir } from "@/lib/subida";
import { EDITABLE, type Archivo, type Caja, type Catalogos, type Comprobante, type Rendicion } from "@/lib/tipos";
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

/** Un archivo en camino, mientras esta pantalla lo sube y espera su lectura. */
type Subida = {
  clave: string;
  nombre: string;
  estado: "subiendo" | "leyendo" | "listo" | "error";
  error?: string;
};

/** Cuántos archivos se suben y leen a la vez. */
const EN_PARALELO = 3;

const leyendo = (a: Archivo) => a.estado_lectura === "pendiente" || a.estado_lectura === "procesando";

function HojaRendicion({ id, persona }: { id: string; persona: Persona }) {
  const { catalogos, error: errorCatalogos } = useCatalogos();
  const [datos, setDatos] = useState<DatosRendicion | null>(null);
  const [subidas, setSubidas] = useState<Subida[]>([]);
  const datosActuales = useRef(datos);
  useEffect(() => {
    datosActuales.current = datos;
  }, [datos]);
  // Archivos cuya lectura ya pidió esta pantalla: no se piden dos veces.
  const pedidos = useRef(new Set<string>());
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
  const editableAhora = !!datos && datos.rendicion.responsable_id === persona.id && EDITABLE.includes(datos.rendicion.estado);
  useEffect(() => {
    if (!datos || !editableAhora) return;
    for (const a of datos.archivos) {
      if (a.estado_lectura === "pendiente" && !pedidos.current.has(a.id)) pedirLectura(a.id).catch(() => {});
    }
  }, [datos, editableAhora, pedirLectura]);

  // Mientras el servidor lee algo, se vuelve a mirar cada pocos segundos: la
  // lectura pudo pedirla otra pestaña u otro equipo.
  const hayLectura = !!datos?.archivos.some(leyendo);
  useEffect(() => {
    if (!hayLectura) return;
    const t = setInterval(cargar, 4000);
    return () => clearInterval(t);
  }, [hayLectura, cargar]);

  if (error && !datos) return <Aviso>{error}</Aviso>;
  if (errorCatalogos) return <Aviso>{errorCatalogos}</Aviso>;
  if (!datos || !catalogos) return <p className="text-texto-3" role="status">Cargando…</p>;

  const { rendicion: r, caja, comprobantes, archivos } = datos;
  const editable = r.responsable_id === persona.id && EDITABLE.includes(r.estado);
  const c = cuentas(comprobantes, r.monto, r.no_sustentan ?? []);
  const incompletas = comprobantes.filter((x) => faltan(x).length > 0).length;
  const porLeer = archivos.filter(leyendo).length;

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
      const nueva = await agregarComprobante(r.id, herencia(comprobantes, r.tipo, persona));
      setDatos((d) => d && { ...d, comprobantes: [...d.comprobantes, nueva] });
    });

  const cambiarSubida = (clave: string, cambios: Partial<Subida>) =>
    setSubidas((l) => l.map((s) => (s.clave === clave ? { ...s, ...cambios } : s)));

  const recibir = async (lista: File[]) => {
    if (!lista.length) return;
    setError(null);
    const nuevas = lista.map((f) => ({ archivo: f, clave: crypto.randomUUID() }));
    setSubidas((l) => [
      ...l.filter((s) => s.estado !== "listo"),
      ...nuevas.map(({ archivo, clave }) => ({ clave, nombre: archivo.name, estado: "subiendo" as const })),
    ]);
    // Lo que se hereda se calcula una vez: todo el lote va al mismo proyecto.
    const base = herencia(datosActuales.current?.comprobantes ?? [], r.tipo, persona);
    const cola = [...nuevas];
    const trabajador = async () => {
      for (let n = cola.shift(); n; n = cola.shift()) {
        let archivoId: string | null = null;
        try {
          archivoId = await subir(r.id, n.archivo, base);
          pedidos.current.add(archivoId);
          cambiarSubida(n.clave, { estado: "leyendo" });
          await cargar(); // la fila aparece ya, con «Leyendo…»
          await leer(archivoId);
          cambiarSubida(n.clave, { estado: "listo" });
        } catch (e) {
          cambiarSubida(n.clave, { estado: "error", error: (e as Error).message });
        }
        if (archivoId) await cargar();
      }
    };
    await Promise.all(Array.from({ length: Math.min(EN_PARALELO, nuevas.length) }, trabajador));
  };

  const releer = (archivoId: string) =>
    ejecutar(async () => {
      setDatos((d) => d && { ...d, archivos: d.archivos.map((a) => (a.id === archivoId ? { ...a, estado_lectura: "procesando" } : a)) });
      await pedirLectura(archivoId);
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
        {c.porTipo.some((t) => t.tipo !== "SIN_TIPO") && (
          <Sustento r={r} porTipo={c.porTipo} catalogos={catalogos} editable={editable} onGuardar={guardarRendicion} />
        )}
      </Tarjeta>

      {error && <Aviso>{error}</Aviso>}
      {aviso && <Aviso tono="info">{aviso}</Aviso>}

      <Tarjeta>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-tinta">Comprobantes</h2>
          {editable && comprobantes.length > 0 && (
            <button type="button" onClick={agregar} className="text-sm font-medium text-texto-2 underline">
              + Agregar a mano, sin imagen
            </button>
          )}
        </div>
        {editable && <ZonaDeSubida subidas={subidas} onArchivos={recibir} />}
        {comprobantes.length === 0 ? (
          <p className="mt-4 text-texto-2">
            {editable ? (
              <>
                O si no tienes la imagen,{" "}
                <button type="button" onClick={agregar} className="font-medium text-acento-texto underline">
                  agrega un comprobante a mano
                </button>
                .
              </>
            ) : (
              "Esta rendición no tiene comprobantes."
            )}
          </p>
        ) : (
          <div className={editable ? "mt-5" : ""}>
            <Comprobantes
              filas={comprobantes}
              archivos={archivos}
              catalogos={catalogos}
              editable={editable}
              intento={intento}
              onGuardar={guardarFila}
              onReleer={releer}
            />
          </div>
        )}
      </Tarjeta>

      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={mandar}
            className={botonPrincipal}
            disabled={c.comprobantes === 0 || incompletas > 0 || porLeer > 0}
          >
            Enviar a administración
          </button>
          <span className="text-sm text-texto-2">
            {porLeer > 0
              ? `Leyendo ${porLeer} archivo${porLeer === 1 ? "" : "s"}…`
              : c.comprobantes === 0
              ? "Sube al menos un comprobante para poder enviar."
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
        {/* Lo que todavía no tiene tipo no se puede marcar: se ve recién cuando lo tenga. */}
        {porTipo.filter((t) => t.tipo !== "SIN_TIPO").map((t) => {
          const cuenta = !fuera.has(t.tipo);
          return (
            <button
              key={t.tipo}
              type="button"
              aria-pressed={cuenta}
              disabled={!editable}
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
  archivos,
  catalogos,
  editable,
  intento,
  onGuardar,
  onReleer,
}: {
  filas: Comprobante[];
  archivos: Archivo[];
  catalogos: Catalogos;
  editable: boolean;
  intento: number;
  onGuardar: (id: string, cambios: CambiosComprobante) => void;
  onReleer: (archivoId: string) => void;
}) {
  const enlaces = useEnlaces(archivos);
  const archivoDe = (c: Comprobante) => archivos.find((a) => a.id === c.archivo_id);
  // Cada celda se rearma cuando cambia su valor en la base o falla un guardado.
  const k = (c: Comprobante, campo: string, valor: unknown) => `${c.id}-${campo}-${String(valor)}-${intento}`;
  const num = (v: string) => (v ? Number(v) : null);

  const columnas: Columna[] = [
    {
      etiqueta: "Imagen",
      ancho: "w-24",
      celda: (c) => (
        <Imagen archivo={archivoDe(c)} pagina={c.pagina} enlace={enlaces[c.archivo_id ?? ""]} editable={editable} onReleer={onReleer} />
      ),
    },
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
          disabled={!e}
          onGuardar={(v) => onGuardar(c.id, { total: v === "" ? null : aNumero(v) })}
        />
      ),
    },
  ];

  const pie = (c: Comprobante) => {
    const f = faltan(c);
    const a = archivoDe(c);
    return (
      <div className="flex flex-wrap items-center gap-2">
        {c.descartado ? (
          <span className="text-xs font-semibold text-texto-3">Descartado</span>
        ) : a && leyendo(a) ? null : f.length > 0 ? (
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

/** Enlaces firmados a las imágenes de la rendición, pedidos de una vez. */
function useEnlaces(archivos: Archivo[]): Record<string, string> {
  const [enlaces, setEnlaces] = useState<Record<string, string>>({});
  const rutas = archivos.filter((a) => a.ruta).map((a) => `${a.id}:${a.ruta}`).join("|");
  useEffect(() => {
    if (!rutas) return;
    let vigente = true;
    const pares = rutas.split("|").map((p) => p.split(":") as [string, string]);
    enlacesDeArchivos(pares.map(([, ruta]) => ruta))
      .then((urls) => vigente && setEnlaces(Object.fromEntries(pares.map(([id], i) => [id, urls[i]]))))
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [rutas]);
  return enlaces;
}

function Imagen({
  archivo,
  pagina,
  enlace,
  editable,
  onReleer,
}: {
  archivo: Archivo | undefined;
  pagina: number;
  enlace: string | undefined;
  editable: boolean;
  onReleer: (archivoId: string) => void;
}) {
  if (!archivo) return <span className="text-xs text-texto-3">A mano</span>;
  const pdf = archivo.tipo_mime === "application/pdf";
  return (
    <div className="space-y-1">
      {enlace ? (
        <a
          href={pdf ? `${enlace}#page=${pagina}` : enlace}
          target="_blank"
          rel="noreferrer"
          className="block"
          title="Ver la imagen completa"
        >
          {pdf ? (
            <span className="flex h-12 w-16 items-center justify-center rounded-chico border border-borde-2 bg-superficie-2 text-xs font-semibold text-texto-2">
              PDF{pagina > 1 ? ` · ${pagina}` : ""}
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- enlace firmado y temporal: no pasa por el optimizador
            <img src={enlace} alt="Comprobante" className="h-12 w-16 rounded-chico border border-borde-2 object-cover" />
          )}
        </a>
      ) : (
        <span className="block h-12 w-16 animate-pulse rounded-chico bg-superficie-2" />
      )}
      {leyendo(archivo) ? (
        <span className="block text-xs font-semibold text-info" role="status">
          Leyendo…
        </span>
      ) : archivo.estado_lectura === "fallido" ? (
        <span className="block text-xs text-peligro" title={archivo.error ?? ""}>
          No se leyó.{" "}
          {editable && (
            <button type="button" className="font-semibold underline" onClick={() => onReleer(archivo.id)}>
              Reintentar
            </button>
          )}
        </span>
      ) : archivo.error ? (
        <span className="block text-xs text-aviso" title={archivo.error}>
          Sin comprobante
        </span>
      ) : null}
    </div>
  );
}

function ZonaDeSubida({ subidas, onArchivos }: { subidas: Subida[]; onArchivos: (l: File[]) => void }) {
  const [encima, setEncima] = useState(false);
  const elegir = useRef<HTMLInputElement>(null);
  const camara = useRef<HTMLInputElement>(null);
  const tomar = (l: FileList | null) => l && onArchivos([...l]);
  const listos = subidas.filter((s) => s.estado === "listo").length;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setEncima(true);
      }}
      onDragLeave={() => setEncima(false)}
      onDrop={(e) => {
        e.preventDefault();
        setEncima(false);
        tomar(e.dataTransfer.files);
      }}
      className={`rounded-medio border-2 border-dashed p-5 text-center transition ${
        encima ? "border-acento bg-acento-suave" : "border-borde-2"
      }`}
    >
      <p className="font-medium text-tinta">Sube las fotos o PDF de tus comprobantes</p>
      <p className="mt-1 text-sm text-texto-2">
        Se leen solos: fecha, número, RUC, proveedor, total y concepto. Tú solo revisas.
        <span className="hidden md:inline"> También puedes arrastrarlos aquí.</span>
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => camara.current?.click()} className={`${botonPrincipal} md:hidden`}>
          Tomar foto
        </button>
        <button type="button" onClick={() => elegir.current?.click()} className={`${botonSecundario} md:hidden`}>
          Elegir fotos o PDF
        </button>
        <button type="button" onClick={() => elegir.current?.click()} className={`${botonPrincipal} hidden md:inline-block`}>
          Elegir fotos o PDF
        </button>
      </div>
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
      {subidas.some((s) => s.estado !== "listo") && (
        <ul className="mx-auto mt-4 max-w-md space-y-1 text-left text-sm">
          {subidas
            .filter((s) => s.estado !== "listo")
            .map((s) => (
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
      {listos > 0 && !subidas.some((s) => s.estado === "subiendo" || s.estado === "leyendo") && (
        <p className="mt-3 text-sm text-exito" role="status">
          {listos === 1 ? "1 archivo leído." : `${listos} archivos leídos.`} Revisa lo que falte en la tabla.
        </p>
      )}
    </div>
  );
}
