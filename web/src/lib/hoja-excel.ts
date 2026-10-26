import { numeroCompleto } from "./comprobante";
import { aNumero } from "./cuentas";
import type { Caja, Catalogos, Comprobante, Rendicion } from "./tipos";

/** Las 14 columnas de la hoja de rendición, en el orden de contabilidad. */
export const COLUMNAS = [
  "N° DE CAJA",
  "FECHA DE SOLICITUD",
  "EMPRESA",
  "ADMINISTRADOR",
  "FECHA",
  "TIPO DE COMPROBANTE",
  "N° DE COMPROBANTE",
  "PROVEEDOR",
  "PROYECTO",
  "AREA DEL SOLICITANTE",
  "SOLICITANTE",
  "CONCEPTO",
  "DESCRIPCION-MOTIVO",
  "TOTAL INC IGV",
] as const;

export type Celda = string | number | Date | null;

/** «2026-10-19» como fecha de Excel, sin que el huso horario la corra un día. */
const fecha = (iso: string | null): Date | null => {
  if (!iso) return null;
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
};

export function filasDeHoja(datos: {
  rendicion: Rendicion;
  caja: Caja | null;
  administrador: string;
  comprobantes: Comprobante[];
  catalogos: Catalogos;
}): Celda[][] {
  const { rendicion: r, caja, administrador, catalogos } = datos;
  const nombre = <T extends { id: number | string; nombre: string }>(l: T[], id: number | string | null) =>
    l.find((x) => x.id === id)?.nombre ?? "";
  const empresa = nombre(catalogos.empresas, r.empresa_id);
  const numeroCaja = r.tipo === "caja" ? (caja?.numero ?? "") : `MEMO ${r.numero_memo}`;

  return datos.comprobantes
    .filter((c) => !c.descartado)
    .sort((a, b) => (a.fecha ?? "9999").localeCompare(b.fecha ?? "9999") || a.creado_en.localeCompare(b.creado_en))
    .map((c) => [
      numeroCaja,
      fecha(r.fecha_solicitud),
      empresa,
      administrador,
      fecha(c.fecha),
      nombre(catalogos.tipos, c.tipo_comprobante_id),
      numeroCompleto(c),
      c.proveedor,
      nombre(catalogos.proyectos, c.proyecto_id),
      nombre(catalogos.areas, c.area_id),
      c.solicitante,
      nombre(catalogos.conceptos, c.concepto_id),
      c.descripcion,
      c.total == null ? null : aNumero(c.total),
    ]);
}

/** Arma el .xlsx en el navegador y lo descarga. La librería se carga recién acá. */
export async function descargarExcel(nombreArchivo: string, filas: Celda[][]): Promise<void> {
  const { Workbook } = (await import("exceljs")).default;
  const libro = new Workbook();
  const hoja = libro.addWorksheet("Rendición", { views: [{ state: "frozen", ySplit: 1 }] });
  hoja.columns = COLUMNAS.map((c) => ({
    header: c,
    width: c === "DESCRIPCION-MOTIVO" || c === "PROVEEDOR" ? 34 : c.startsWith("FECHA") ? 13 : 18,
  }));
  hoja.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  hoja.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF007A72" } };
  filas.forEach((f) => hoja.addRow(f));
  hoja.getColumn(2).numFmt = "dd/mm/yyyy";
  hoja.getColumn(5).numFmt = "dd/mm/yyyy";
  hoja.getColumn(14).numFmt = "#,##0.00";

  // El total con fórmula: si contabilidad corrige un importe, la suma lo sigue.
  const ultima = filas.length + 1;
  const total = hoja.addRow([]);
  total.getCell(13).value = "TOTAL";
  total.getCell(14).value = { formula: `SUM(N2:N${ultima})`, result: filas.reduce((s, f) => s + (Number(f[13]) || 0), 0) };
  total.font = { bold: true };

  const datos = await libro.xlsx.writeBuffer();
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(
    new Blob([datos], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
  );
  enlace.download = `${nombreArchivo}.xlsx`;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 10_000);
}
