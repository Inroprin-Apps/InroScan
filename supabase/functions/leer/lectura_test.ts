import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { armarPrompt, type Catalogo, completar, esquema, type Fila, normalizar, textoDeGemini } from "./lectura.ts";

const cat: Catalogo = {
  tipos: [
    { id: "FACTURA", nombre: "FACTURA ELECTRONICA" },
    { id: "BOLETA", nombre: "BOLETA DE VENTA" },
    { id: "PLANILLA_MOVILIDAD", nombre: "PLANILLA DE MOVILIDAD" },
    { id: "NOTA_CREDITO", nombre: "NOTA DE CRÉDITO" },
  ],
  conceptos: [
    { id: 10, nombre: "VIATICOS", categoria: "COMERCIAL", subcategoria: "GASTOS COMERCIALES" },
    { id: 11, nombre: "MOVILIDAD DE PERSONAL", categoria: "PERSONAL", subcategoria: "MOVILIDAD DE PERSONAL" },
  ],
};

const vacia: Fila = {
  fecha: null,
  tipo_comprobante_id: null,
  serie: "",
  numero: "",
  ruc: "",
  proveedor: "",
  total: null,
  moneda: "PEN",
  concepto_id: null,
  descripcion: "",
  solicitante: "",
};

Deno.test("normaliza una factura bien leída", () => {
  const [l] = normalizar([{
    pagina: 1,
    tipo: "FACTURA",
    serie: "f001",
    numero: "006384",
    fecha: "2026-10-20",
    ruc: "20512345678",
    proveedor: "Grifo San Juan S.A.C.",
    total: 250.5,
    moneda: "PEN",
    concepto: "viáticos",
    descripcion: "almuerzo",
    persona: "",
  }], cat);
  assertEquals(l, {
    pagina: 1,
    fecha: "2026-10-20",
    tipo_comprobante_id: "FACTURA",
    serie: "F001",
    numero: "6384",
    ruc: "20512345678",
    proveedor: "GRIFO SAN JUAN S.A.C.",
    total: 250.5,
    moneda: "PEN",
    concepto_id: 10,
    descripcion: "ALMUERZO",
    persona: "",
  });
});

Deno.test("lo que no calza con las listas o los formatos queda vacío", () => {
  const [l] = normalizar([{
    pagina: 0,
    tipo: "OTRO",
    serie: "",
    numero: "010010",
    fecha: "2026-02-30",
    ruc: "12345",
    proveedor: "x",
    total: "1,234.50",
    moneda: "EUR",
    concepto: "INVENTADO",
    descripcion: "",
    persona: "",
  }], cat);
  assertEquals(l.tipo_comprobante_id, null);
  assertEquals(l.fecha, null);
  assertEquals(l.ruc, "");
  assertEquals(l.concepto_id, null);
  assertEquals(l.moneda, "PEN");
  assertEquals(l.pagina, 1);
  assertEquals(l.total, 1234.5);
  // Sin serie, el número de una planilla se copia tal cual.
  assertEquals(l.numero, "010010");
});

Deno.test("una nota de crédito resta", () => {
  const [l] = normalizar([{ tipo: "NOTA_CREDITO", total: 30, numero: "1" }], cat);
  assertEquals(l.total, -30);
});

Deno.test("descarta entradas sin nada que las identifique y respuestas que no son lista", () => {
  assertEquals(normalizar([{ tipo: "BOLETA", fecha: "2026-10-01" }, null, "x"], cat), []);
  assertEquals(normalizar({ no: "lista" }, cat), []);
});

Deno.test("completar solo llena lo vacío", () => {
  const [l] = normalizar([{
    tipo: "BOLETA",
    serie: "EB01",
    numero: "135",
    fecha: "2026-10-21",
    ruc: "10456789012",
    proveedor: "POLLERÍA",
    total: 40,
    concepto: "VIATICOS",
    descripcion: "CENA",
    persona: "",
  }], cat);
  const fila: Fila = { ...vacia, numero: "999", total: "38.00", descripcion: "lo que escribió", solicitante: "ANA" };
  assertEquals(completar(fila, l), {
    fecha: "2026-10-21",
    tipo_comprobante_id: "BOLETA",
    ruc: "10456789012",
    proveedor: "POLLERÍA",
    concepto_id: 10,
  });
});

Deno.test("en una planilla, quien firma pasa a solicitante si está vacío", () => {
  const [l] = normalizar([{
    tipo: "PLANILLA_MOVILIDAD",
    numero: "010010",
    proveedor: "Ivan Camacho",
    persona: "Ivan Camacho",
    total: 24,
  }], cat);
  assertEquals(completar(vacia, l).solicitante, "IVAN CAMACHO");
  assertEquals(completar({ ...vacia, solicitante: "ANA" }, l).solicitante, undefined);
});

Deno.test("el prompt y el esquema llevan las listas cerradas", () => {
  const p = armarPrompt(cat, "memo");
  assertEquals(p.includes("FACTURA: FACTURA ELECTRONICA"), true);
  assertEquals(p.includes("MOVILIDAD DE PERSONAL (PERSONAL / MOVILIDAD DE PERSONAL)"), true);
  assertEquals(p.includes("MEMO DE VIÁTICOS"), true);
  assertEquals(armarPrompt(cat, "caja").includes("CAJA CHICA"), true);
  const e = esquema(cat) as { items: { properties: { tipo: { enum: string[] } } } };
  assertEquals(e.items.properties.tipo.enum, ["FACTURA", "BOLETA", "PLANILLA_MOVILIDAD", "NOTA_CREDITO", "OTRO"]);
});

Deno.test("lee el JSON de la respuesta de Gemini o explica por qué no", () => {
  assertEquals(textoDeGemini({ candidates: [{ content: { parts: [{ text: '[{"a":1}]' }] } }] }), [{ a: 1 }]);
  assertThrows(() => textoDeGemini({ candidates: [{ finishReason: "SAFETY" }] }), Error, "SAFETY");
  assertThrows(() => textoDeGemini({ candidates: [{ content: { parts: [{ text: "hola" }] } }] }), Error, "JSON");
});
