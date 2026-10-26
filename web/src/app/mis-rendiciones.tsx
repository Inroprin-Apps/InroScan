"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useCatalogos } from "@/lib/catalogos";
import { cuentas, aNumero, soles } from "@/lib/cuentas";
import { crearMemo, crearReposicion, leerMisCajas, leerMisRendiciones, type RendicionConResumen } from "@/lib/datos";
import type { Persona } from "@/lib/sesion";
import type { Caja } from "@/lib/tipos";
import { Aviso, BarraConsumo, Estado, Tarjeta, botonPrincipal, botonSecundario, campo } from "./piezas";

export const tituloRendicion = (r: { tipo: string; numero_memo: string | null; correlativo: number | null }, caja?: Caja | null) =>
  r.tipo === "memo" ? `Memo ${r.numero_memo}` : `Caja ${caja?.numero ?? "?"} · Reposición ${r.correlativo}`;

const hoy = () => new Date().toLocaleDateString("en-CA"); // AAAA-MM-DD en la hora local

export function MisRendiciones({ persona }: { persona: Persona }) {
  const router = useRouter();
  const { catalogos } = useCatalogos();
  const [rendiciones, setRendiciones] = useState<RendicionConResumen[] | null>(null);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nuevoMemo, setNuevoMemo] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([leerMisRendiciones(), leerMisCajas(persona.id)]);
      setRendiciones(r);
      setCajas(c);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [persona.id]);

  useEffect(() => {
    // Se lee al entrar; setState ocurre después del await, no en el render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar();
  }, [cargar]);

  const abrir = (id: string) => router.push(`/rendicion/?id=${id}`);

  const reponer = async (caja: Caja) => {
    setError(null);
    try {
      abrir(await crearReposicion(caja, persona.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Una caja con su ciclo en curso no ofrece abrir otro: la base no lo
  // permitiría, y el botón sería una invitación a un error.
  const enCurso = new Set(
    (rendiciones ?? []).filter((r) => ["abierta", "enviada", "observada"].includes(r.estado)).map((r) => r.caja_id),
  );
  const cajaDe = (id: number | null) => cajas.find((c) => c.id === id) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-tinta">
            {persona.es_administracion ? "Rendiciones" : "Mis rendiciones"}
          </h1>
          <p className="mt-1 text-texto-2">
            {persona.es_administracion
              ? "Como administración ves las de todos."
              : "Tus memos de viáticos y las cajas chicas que administras."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {cajas
            .filter((c) => !enCurso.has(c.id))
            .map((c) => (
              <button key={c.id} type="button" onClick={() => reponer(c)} className={botonSecundario}>
                Nueva reposición · Caja {c.numero}
              </button>
            ))}
          <button type="button" onClick={() => setNuevoMemo(true)} className={botonPrincipal} disabled={nuevoMemo}>
            Nuevo memo
          </button>
        </div>
      </div>

      {error && <Aviso>{error}</Aviso>}

      {nuevoMemo && (
        <FormularioMemo
          persona={persona}
          empresas={(catalogos?.empresas ?? []).filter((e) => e.activo)}
          onCancelar={() => setNuevoMemo(false)}
          onCreado={abrir}
        />
      )}

      {rendiciones == null && !error && <p className="text-texto-3" role="status">Cargando…</p>}

      {rendiciones?.length === 0 && !nuevoMemo && (
        <Tarjeta>
          <p className="text-texto-2">
            Todavía no tienes rendiciones. Empieza con <b>Nuevo memo</b> cuando recibas el dinero de un viaje.
          </p>
        </Tarjeta>
      )}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rendiciones?.map((r) => {
          const c = cuentas(r.comprobantes, r.monto, r.no_sustentan ?? []);
          return (
            <li key={r.id}>
              <Link
                href={`/rendicion/?id=${r.id}`}
                className="block h-full rounded-grande bg-superficie p-5 shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-display text-lg font-semibold text-tinta">{tituloRendicion(r, cajaDe(r.caja_id))}</h2>
                  <Estado estado={r.estado} />
                </div>
                <p className="mt-1 text-sm text-texto-3">
                  Solicitado el {new Date(`${r.fecha_solicitud}T00:00`).toLocaleDateString("es-PE")} ·{" "}
                  {c.comprobantes} comprobante{c.comprobantes === 1 ? "" : "s"}
                </p>
                <div className="mt-4">
                  <BarraConsumo gastado={c.gastado} monto={aNumero(r.monto)} consumo={c.consumo} />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FormularioMemo({
  persona,
  empresas,
  onCancelar,
  onCreado,
}: {
  persona: Persona;
  empresas: { id: number; nombre: string }[];
  onCancelar: () => void;
  onCreado: (id: string) => void;
}) {
  const [numero, setNumero] = useState("");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(hoy());
  const [empresaElegida, setEmpresa] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Con una sola empresa activa no hay nada que elegir.
  const empresa = empresaElegida ?? (empresas.length === 1 ? empresas[0].id : null);

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    const importe = aNumero(monto);
    if (!numero.trim()) return setError("Escribe el número de memo.");
    if (!(importe > 0)) return setError("Escribe el monto que recibiste.");
    if (empresa == null) return setError("Elige la empresa.");
    setGuardando(true);
    setError(null);
    try {
      onCreado(
        await crearMemo({
          numero_memo: numero.trim(),
          monto: importe,
          fecha_solicitud: fecha,
          empresa_id: empresa,
          responsable_id: persona.id,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
      setGuardando(false);
    }
  };

  return (
    <Tarjeta>
      <form onSubmit={crear} className="space-y-4">
        <h2 className="font-display text-lg font-semibold text-tinta">Nuevo memo de viáticos</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm font-medium text-texto-2">
            N° de memo
            <input className={`mt-1 ${campo}`} value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="675-2026" autoFocus />
          </label>
          <label className="block text-sm font-medium text-texto-2">
            Monto recibido
            <input
              className={`mt-1 ${campo}`}
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
            />
          </label>
          <label className="block text-sm font-medium text-texto-2">
            Fecha de solicitud
            <input className={`mt-1 ${campo}`} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </label>
          {empresas.length > 1 && (
            <label className="block text-sm font-medium text-texto-2 sm:col-span-3">
              Empresa
              <select className={`mt-1 ${campo}`} value={empresa ?? ""} onChange={(e) => setEmpresa(Number(e.target.value) || null)}>
                <option value="">Elige…</option>
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {error && <Aviso>{error}</Aviso>}
        {monto && aNumero(monto) > 0 && (
          <p className="text-sm text-texto-3">Vas a rendir {soles(aNumero(monto))}.</p>
        )}
        <div className="flex gap-2">
          <button type="submit" className={botonPrincipal} disabled={guardando}>
            {guardando ? "Creando…" : "Crear memo"}
          </button>
          <button type="button" className={botonSecundario} onClick={onCancelar} disabled={guardando}>
            Cancelar
          </button>
        </div>
      </form>
    </Tarjeta>
  );
}
