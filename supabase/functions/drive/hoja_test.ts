import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  armarHoja,
  type Catalogos,
  type Comprobante,
  formulaSustentado,
  formulaTotal,
  nombreDeImagen,
  type Rendicion,
  rutaDeCarpeta,
  titulo,
  xlsx,
} from "./hoja.ts";

const cat: Catalogos = {
  empresas: [{ id: 1, nombre: "INROPRIN" }],
  areas: [{ id: 3, nombre: "COMERCIAL INROPRIN" }],
  proyectos: [{ id: 1, nombre: "PAQ 02 CHINA CIVIL" }],
  conceptos: [{ id: 1, nombre: "VIATICOS" }],
  tipos: [
    { id: "BOLETA", nombre: "BOLETA DE VENTA", sustenta: true },
    { id: "DJ", nombre: "DECLARACIÓN JURADA", sustenta: false },
  ],
};
const memo: Rendicion = {
  id: "r1",
  tipo: "memo",
  numero_memo: "675-2026",
  correlativo: null,
  empresa_id: 1,
  fecha_solicitud: "2026-10-19",
  monto: "675.00",
  estado: "enviada",
  version: 1,
  no_sustentan: ["DJ"],
};
const c = (x: Partial<Comprobante>): Comprobante => ({
  id: "c",
  archivo_id: null,
  pagina: 1,
  fecha: "2026-10-20",
  tipo_comprobante_id: "BOLETA",
  serie: "EB01",
  numero: "135",
  proveedor: "POLLERÍA",
  proyecto_id: 1,
  area_id: 3,
  solicitante: "ANA",
  concepto_id: 1,
  descripcion: "CENA",
  total: "45.50",
  moneda: "PEN",
  descartado: false,
  creado_en: "2026-10-20T10:00:00Z",
  ...x,
});

Deno.test("carpetas y nombres", () => {
  assertEquals(rutaDeCarpeta(memo, null, "Ana Pérez"), ["Memos", "Ana Pérez", "Memo 675-2026"]);
  assertEquals(rutaDeCarpeta({ ...memo, tipo: "caja", correlativo: 7 }, { numero: "03" }, "x"), [
    "Cajas",
    "Caja 03",
    "Reposición 7",
  ]);
  assertEquals(titulo({ ...memo, tipo: "caja", correlativo: 7 }, { numero: "03" }), "Caja 03 · Reposición 7");
  assertEquals(
    nombreDeImagen(c({ proveedor: "A/B S.A.C." }), "a1", "jpg"),
    "2026-10-20 Boleta EB01-135 A-B S.A.C..jpg",
  );
  assertEquals(nombreDeImagen(undefined, "a1", "pdf"), "a1.pdf");
});

Deno.test("la hoja: filas, enlaces, dólares aparte y lo que sustenta", () => {
  const h = armarHoja({
    rendicion: memo,
    caja: null,
    administrador: "Ana Pérez",
    catalogos: cat,
    enlaces: new Map([["a1", "https://drive/a1"]]),
    comprobantes: [
      c({ id: "1", archivo_id: "a1" }),
      c({ id: "2", fecha: "2026-10-21", tipo_comprobante_id: "DJ", serie: "", numero: "", total: 8 }),
      c({ id: "3", fecha: "2026-10-22", moneda: "USD", total: "40" }),
      c({ id: "4", descartado: true }),
    ],
  });
  assertEquals(h.filas.length, 3);
  assertEquals(h.filas[0][0], "MEMO 675-2026");
  assertEquals(h.filas[0][6], { text: "EB01-135", hyperlink: "https://drive/a1" });
  assertEquals(h.filas[2][12], "CENA (US$)");
  assertEquals(h.enDolares, [4]);
  assertEquals(h.sustentan, [2]);
  assertEquals(h.dolares, 40);
  assertEquals(formulaTotal(h), "SUM(N2:N4)-N4");
  assertEquals(formulaSustentado(h, "Rendición"), "'Rendición'!N2");
});

Deno.test("el .xlsx se arma y lleva sus fórmulas", async () => {
  const h = armarHoja({
    rendicion: memo,
    caja: null,
    administrador: "Ana",
    catalogos: cat,
    enlaces: new Map(),
    comprobantes: [c({})],
  });
  const bytes = await xlsx(h, {
    titulo: "Memo 675-2026",
    responsable: "Ana",
    estado: "enviada",
    version: 1,
    recibido: 675,
    tipo: "memo",
  });
  const { default: ExcelJS } = await import("npm:exceljs@4.4.0");
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(bytes.buffer as ArrayBuffer);
  const hoja = libro.getWorksheet("Rendición")!;
  assertEquals(hoja.getCell("A1").value, "N° DE CAJA");
  assertEquals((hoja.getCell("N3").value as { formula: string }).formula, "SUM(N2:N2)");
  const r = libro.getWorksheet("Resumen")!;
  assertEquals((r.getCell("B6").value as { formula: string }).formula, "'Rendición'!N3");
  assertEquals((r.getCell("B9").value as { formula: string }).formula, "B5-B6");
});
