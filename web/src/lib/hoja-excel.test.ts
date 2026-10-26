import { describe, expect, it } from "vitest";
import { COLUMNAS, filasDeHoja } from "./hoja-excel";
import type { Catalogos, Comprobante, Rendicion } from "./tipos";

const catalogos: Catalogos = {
  empresas: [{ id: 1, nombre: "INROPRIN", activo: true }],
  areas: [{ id: 3, nombre: "COMERCIAL INROPRIN", activo: true }],
  proyectos: [{ id: 1, nombre: "PAQ 02 CHINA CIVIL", activo: true }],
  tipos: [{ id: "BOLETA", nombre: "BOLETA DE VENTA", sustenta: true, orden: 3, activo: true }],
  conceptos: [{ id: 1, nombre: "VIATICOS", categoria: "C", subcategoria: "S", activo: true }],
};
const memo = { tipo: "memo", numero_memo: "675-2026", empresa_id: 1, fecha_solicitud: "2026-10-19" } as Rendicion;
const fila = (x: Partial<Comprobante>) =>
  ({
    fecha: "2026-10-20", tipo_comprobante_id: "BOLETA", serie: "EB01", numero: "135", proveedor: "POLLERÍA",
    proyecto_id: 1, area_id: 3, solicitante: "ANA", concepto_id: 1, descripcion: "CENA", total: "45.50",
    descartado: false, creado_en: "2026-10-20T10:00:00Z", ...x,
  }) as Comprobante;

describe("la hoja de 14 columnas", () => {
  it("una fila por comprobante, sin los descartados, ordenada por fecha", () => {
    const filas = filasDeHoja({
      rendicion: memo,
      caja: null,
      administrador: "Ana Pérez",
      catalogos,
      comprobantes: [fila({ fecha: "2026-10-22", total: 10 }), fila({ descartado: true }), fila({})],
    });
    expect(COLUMNAS).toHaveLength(14);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toEqual([
      "MEMO 675-2026", new Date(Date.UTC(2026, 9, 19)), "INROPRIN", "Ana Pérez", new Date(Date.UTC(2026, 9, 20)),
      "BOLETA DE VENTA", "EB01-135", "POLLERÍA", "PAQ 02 CHINA CIVIL", "COMERCIAL INROPRIN", "ANA", "VIATICOS", "CENA", 45.5,
    ]);
    expect(filas[1][13]).toBe(10);
  });
});
