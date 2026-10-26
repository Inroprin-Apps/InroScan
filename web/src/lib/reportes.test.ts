import { describe, expect, it } from "vitest";
import type { FilaReporte } from "./admin";
import { ESTADOS_REPORTE, agrupar } from "./reportes";

const f = (x: Partial<FilaReporte>): FilaReporte => ({
  total: "10.00", moneda: "PEN", fecha: "2026-10-20", proyecto_id: 1, area_id: 3, concepto_id: 1, tipo_comprobante_id: "BOLETA",
  rendicion: { estado: "aprobada", tipo: "memo", responsable_id: "ana" }, ...x,
});

describe("reportes", () => {
  it("suma por grupo, separa dólares y respeta el estado", () => {
    const filas = [
      f({ total: "100.50" }),
      f({ total: 20, moneda: "USD" }),
      f({ proyecto_id: 2, total: "300" }),
      f({ proyecto_id: null }),
      f({ rendicion: { estado: "abierta", tipo: "memo", responsable_id: "ana" } }),
      f({ total: null }),
    ];
    expect(agrupar(filas, "proyecto", ESTADOS_REPORTE.aprobadas)).toEqual([
      { clave: "2", cuantos: 1, soles: 300, dolares: 0 },
      { clave: "1", cuantos: 2, soles: 100.5, dolares: 20 },
      { clave: "", cuantos: 1, soles: 10, dolares: 0 },
    ]);
    expect(agrupar(filas, "proyecto", ESTADOS_REPORTE.todas).find((g) => g.clave === "1")?.cuantos).toBe(3);
  });
  it("por mes va en orden de calendario", () => {
    const g = agrupar([f({ fecha: "2026-10-01" }), f({ fecha: "2026-09-15" })], "mes", ESTADOS_REPORTE.todas);
    expect(g.map((x) => x.clave)).toEqual(["2026-09", "2026-10"]);
  });
});
