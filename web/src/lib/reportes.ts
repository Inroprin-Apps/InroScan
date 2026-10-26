import type { FilaReporte } from "./admin";
import { aNumero } from "./cuentas";

export type Agrupar = "proyecto" | "area" | "concepto" | "persona" | "mes" | "tipo";
export type Grupo = { clave: string; cuantos: number; soles: number; dolares: number };

export const ESTADOS_REPORTE = {
  revisadas: ["enviada", "observada", "aprobada", "repuesta", "liquidada"],
  aprobadas: ["aprobada", "repuesta", "liquidada"],
  todas: ["abierta", "enviada", "observada", "aprobada", "repuesta", "liquidada"],
} as const;

const claveDe = (f: FilaReporte, por: Agrupar): string => {
  const v = {
    proyecto: f.proyecto_id,
    area: f.area_id,
    concepto: f.concepto_id,
    persona: f.rendicion?.responsable_id,
    mes: f.fecha?.slice(0, 7),
    tipo: f.tipo_comprobante_id,
  }[por];
  return v == null ? "" : String(v);
};

/** Suma por grupo; soles y dólares por separado (no se convierten). Lo más grande primero. */
export function agrupar(filas: FilaReporte[], por: Agrupar, estados: readonly string[]): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const f of filas) {
    if (!f.rendicion || !estados.includes(f.rendicion.estado) || f.total == null) continue;
    const clave = claveDe(f, por);
    const g = grupos.get(clave) ?? { clave, cuantos: 0, soles: 0, dolares: 0 };
    g.cuantos++;
    if (f.moneda === "USD") g.dolares += aNumero(f.total);
    else g.soles += aNumero(f.total);
    grupos.set(clave, g);
  }
  const redondo = (n: number) => Math.round(n * 100) / 100;
  return [...grupos.values()]
    .map((g) => ({ ...g, soles: redondo(g.soles), dolares: redondo(g.dolares) }))
    .sort((a, b) => (por === "mes" ? a.clave.localeCompare(b.clave) : b.soles - a.soles));
}
