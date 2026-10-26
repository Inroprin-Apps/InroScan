/**
 * Lo que va a Drive, sin red: las filas de la hoja, sus fórmulas, los nombres
 * de carpetas y archivos.
 *
 * La hoja se arma como .xlsx y Drive la convierte a Google Sheets al subirla.
 * Así las fórmulas viajan en el idioma neutro del archivo y no dependen de la
 * configuración regional de la hoja (en es_PE el separador es la coma, y
 * `es_PE` ni siquiera es un idioma que Sheets acepte: ver CONTEXTO.md §6).
 */

export type Catalogos = {
  empresas: { id: number; nombre: string }[];
  areas: { id: number; nombre: string }[];
  proyectos: { id: number; nombre: string }[];
  conceptos: { id: number; nombre: string }[];
  tipos: { id: string; nombre: string; sustenta: boolean }[];
};

export type Rendicion = {
  id: string;
  tipo: "caja" | "memo";
  numero_memo: string | null;
  correlativo: number | null;
  empresa_id: number;
  fecha_solicitud: string;
  monto: number | string;
  estado: string;
  version: number;
  no_sustentan: string[] | null;
};

export type Comprobante = {
  id: string;
  archivo_id: string | null;
  pagina: number;
  fecha: string | null;
  tipo_comprobante_id: string | null;
  serie: string;
  numero: string;
  proveedor: string;
  proyecto_id: number | null;
  area_id: number | null;
  solicitante: string;
  concepto_id: number | null;
  descripcion: string;
  total: number | string | null;
  moneda: string;
  descartado: boolean;
  creado_en: string;
};

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

const CORTOS: Record<string, string> = {
  FACTURA: "Factura",
  RHE: "Recibo honorarios",
  BOLETA: "Boleta",
  PLANILLA_MOVILIDAD: "Planilla movilidad",
  VOUCHER: "Voucher",
  TICKET: "Ticket",
  RECIBO: "Recibo",
  DJ: "Declaración jurada",
  NOTA_CREDITO: "Nota de crédito",
};

export const aNumero = (v: number | string | null | undefined) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export const numeroCompleto = (c: { serie: string; numero: string }) => [c.serie, c.numero].filter(Boolean).join("-");

export function titulo(r: Rendicion, caja: { numero: string } | null): string {
  return r.tipo === "memo" ? `Memo ${r.numero_memo}` : `Caja ${caja?.numero ?? "?"} · Reposición ${r.correlativo}`;
}

/** Drive admite casi todo en un nombre; se quitan las barras para que no parezcan rutas. */
const limpio = (t: string) => t.replace(/[\\/]+/g, "-").replace(/\s+/g, " ").trim();

/** Dónde vive la rendición dentro de la unidad compartida. */
export function rutaDeCarpeta(r: Rendicion, caja: { numero: string } | null, responsable: string): string[] {
  return r.tipo === "caja"
    ? ["Cajas", limpio(`Caja ${caja?.numero ?? "?"}`), limpio(`Reposición ${r.correlativo}`)]
    : ["Memos", limpio(responsable || "Sin nombre"), limpio(`Memo ${r.numero_memo}`)];
}

/** «2026-10-20 Boleta EB01-135 POLLERÍA EL REY.jpg»: que se entienda sin abrirla. */
export function nombreDeImagen(c: Comprobante | undefined, archivoId: string, ext: string): string {
  if (!c) return `${archivoId}.${ext}`;
  const partes = [c.fecha ?? "sin fecha", CORTOS[c.tipo_comprobante_id ?? ""] ?? "", numeroCompleto(c), c.proveedor];
  return `${limpio(partes.filter(Boolean).join(" ")).slice(0, 120)}.${ext}`;
}

export type Celda = string | number | Date | null | { text: string; hyperlink: string };

export type Hoja = {
  filas: Celda[][];
  /** Filas (1 = títulos) en dólares: no entran al total en soles. */
  enDolares: number[];
  /** Filas cuyo tipo sustenta en esta rendición. */
  sustentan: number[];
  dolares: number;
};

const fecha = (iso: string | null): Date | null => {
  if (!iso) return null;
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
};

export function armarHoja(datos: {
  rendicion: Rendicion;
  caja: { numero: string } | null;
  administrador: string;
  comprobantes: Comprobante[];
  catalogos: Catalogos;
  /** Enlace a la imagen en Drive de cada archivo. */
  enlaces: Map<string, string>;
}): Hoja {
  const { rendicion: r, caja, administrador, catalogos: cat, enlaces } = datos;
  const nombre = <T extends { id: number | string; nombre: string }>(l: T[], id: number | string | null) =>
    l.find((x) => x.id === id)?.nombre ?? "";
  const fuera = new Set(r.no_sustentan ?? []);
  const vigentes = datos.comprobantes
    .filter((c) => !c.descartado)
    .sort((a, b) => (a.fecha ?? "9999").localeCompare(b.fecha ?? "9999") || a.creado_en.localeCompare(b.creado_en));

  const hoja: Hoja = { filas: [], enDolares: [], sustentan: [], dolares: 0 };
  vigentes.forEach((c, i) => {
    const fila = i + 2;
    const enlace = c.archivo_id ? enlaces.get(c.archivo_id) : undefined;
    const numero = numeroCompleto(c);
    const total = c.total == null ? null : aNumero(c.total);
    if (c.moneda === "USD") {
      hoja.enDolares.push(fila);
      hoja.dolares += total ?? 0;
    } else if (c.tipo_comprobante_id && !fuera.has(c.tipo_comprobante_id)) {
      hoja.sustentan.push(fila);
    }
    hoja.filas.push([
      r.tipo === "caja" ? (caja?.numero ?? "") : `MEMO ${r.numero_memo}`,
      fecha(r.fecha_solicitud),
      nombre(cat.empresas, r.empresa_id),
      administrador,
      fecha(c.fecha),
      nombre(cat.tipos, c.tipo_comprobante_id),
      // El N° enlaza a su imagen: la pregunta «¿corresponde este gasto?» se
      // responde mirando el papel.
      enlace && numero ? { text: numero, hyperlink: enlace } : numero,
      c.proveedor,
      nombre(cat.proyectos, c.proyecto_id),
      nombre(cat.areas, c.area_id),
      c.solicitante,
      nombre(cat.conceptos, c.concepto_id),
      c.moneda === "USD" ? `${c.descripcion} (US$)`.trim() : c.descripcion,
      total,
    ]);
  });
  hoja.dolares = Math.round(hoja.dolares * 100) / 100;
  return hoja;
}

/** El total en soles: la columna entera menos las filas en dólares, con fórmula viva. */
export function formulaTotal(h: Hoja): string {
  const ultima = h.filas.length + 1;
  const resta = h.enDolares.map((f) => `-N${f}`).join("");
  return `SUM(N2:N${Math.max(ultima, 2)})${resta}`;
}

/** Lo sustentado: la suma de las filas cuyo tipo sustenta. */
export function formulaSustentado(h: Hoja, hojaNombre: string): string {
  return h.sustentan.length ? h.sustentan.map((f) => `'${hojaNombre}'!N${f}`).join("+") : "0";
}

/** Arma el .xlsx: la hoja de 14 columnas y un resumen, con fórmulas vivas. */
export async function xlsx(
  h: Hoja,
  resumen: {
    titulo: string;
    responsable: string;
    estado: string;
    version: number;
    recibido: number;
    tipo: "caja" | "memo";
  },
): Promise<Uint8Array> {
  const { default: ExcelJS } = await import("npm:exceljs@4.4.0");
  const libro = new ExcelJS.Workbook();
  const NOMBRE = "Rendición";
  const hoja = libro.addWorksheet(NOMBRE, { views: [{ state: "frozen", ySplit: 1 }] });
  hoja.columns = COLUMNAS.map((c) => ({
    header: c,
    width: c === "DESCRIPCION-MOTIVO" || c === "PROVEEDOR" ? 34 : c.startsWith("FECHA") ? 13 : 18,
  }));
  hoja.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  hoja.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF007A72" } };
  for (const f of h.filas) {
    const fila = hoja.addRow(f);
    const n = fila.getCell(7);
    if (n.value && typeof n.value === "object" && "hyperlink" in n.value) {
      n.font = { color: { argb: "FF006DB1" }, underline: true };
    }
  }
  for (const f of h.enDolares) hoja.getCell(`N${f}`).numFmt = '"US$" #,##0.00';
  hoja.getColumn(2).numFmt = "dd/mm/yyyy";
  hoja.getColumn(5).numFmt = "dd/mm/yyyy";
  hoja.getColumn(14).numFmt = "#,##0.00";
  const total = hoja.addRow([]);
  const filaTotal = total.number;
  total.getCell(13).value = h.enDolares.length ? "TOTAL S/ (sin dólares)" : "TOTAL";
  total.getCell(14).value = { formula: formulaTotal(h) };
  total.font = { bold: true };

  const r = libro.addWorksheet("Resumen");
  r.columns = [{ width: 28 }, { width: 22 }];
  const ref = (c: string) => ({ formula: c });
  const filas: [string, unknown][] = [
    ["Rendición", resumen.titulo],
    [resumen.tipo === "caja" ? "Administrador de caja" : "Responsable", resumen.responsable],
    ["Estado", resumen.estado],
    ["Versión", resumen.version],
    [resumen.tipo === "caja" ? "Fondo" : "Recibido", resumen.recibido],
    ["Gastado (S/)", ref(`'${NOMBRE}'!N${filaTotal}`)],
    ["Sustentado", ref(formulaSustentado(h, NOMBRE))],
    ["No sustenta", ref("B6-B7")],
    ["Saldo (positivo: por devolver)", ref("B5-B6")],
  ];
  if (h.dolares) filas.push(["En dólares, sin convertir", h.dolares]);
  filas.forEach(([k, v]) => r.addRow([k, v]));
  r.getColumn(1).font = { bold: true };
  for (const n of [5, 6, 7, 8, 9]) r.getCell(`B${n}`).numFmt = '"S/" #,##0.00';
  if (h.dolares) r.getCell("B10").numFmt = '"US$" #,##0.00';

  return new Uint8Array(await libro.xlsx.writeBuffer());
}
