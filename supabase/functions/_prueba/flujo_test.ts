/**
 * El flujo completo del servidor con el código real de «leer» y «drive»:
 * subir → leer → enviar → carpeta, imágenes, hoja y PDF en Drive → reenviar →
 * aprobar → borrar de Supabase solo lo que Drive tiene verificado.
 */

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1.0.14";
import { cargarFuncion, comprobanteVacio, simulador, SUPABASE } from "./simulador.ts";

const sim = simulador();
Deno.env.set("SUPABASE_URL", SUPABASE);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "clave-de-servicio");
Deno.env.set("GEMINI_API_KEY", "clave-gemini");
Deno.env.set("GOOGLE_CLIENT_SECRET", "secreto");
globalThis.fetch = sim.pedir as typeof fetch;
const leer = await cargarFuncion("../leer/index.ts");
const drive = await cargarFuncion("../drive/index.ts");

async function llamar(h: (r: Request) => Promise<Response>, token: string | null, cuerpo: unknown) {
  const r = await h(
    new Request("http://funcion/", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(cuerpo),
    }),
  );
  return { status: r.status, cuerpo: await r.json() };
}

// --- Datos de partida --------------------------------------------------------

const { db, storage } = sim;
const persona = (id: string, nombre: string, admin = false) => ({
  id,
  correo: `${id}@inroprin.com`,
  nombre,
  area_id: 3,
  es_administracion: admin,
  activo: true,
});
db.personas.push(persona("ana", "Ana Pérez"), persona("beto", "Beto Ruiz"), persona("tomas", "Tomás Donoso", true));
sim.sesiones.set("t-ana", "ana").set("t-beto", "beto").set("t-tomas", "tomas");

const rendicion = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  tipo: "memo",
  caja_id: null,
  correlativo: null,
  numero_memo: "675-2026",
  empresa_id: 1,
  fecha_solicitud: "2026-10-19",
  responsable_id: "ana",
  monto: "675.00",
  estado: "abierta",
  version: 0,
  no_sustentan: ["DJ"],
  observacion: "",
  drive_carpeta_id: null,
  ...extra,
});
db.rendiciones.push(rendicion("r1"));

/** Bytes con todos los valores posibles (también \r\n): una copia que no sea idéntica se nota. */
const bytesDe = (semilla: number, largo = 3000) =>
  Uint8Array.from({ length: largo }, (_, i) => (i * 31 + semilla) % 256);

function subido(id: string, rid: string, mime: string, semilla: number, placeholder: Record<string, unknown> = {}) {
  const ext = mime === "application/pdf" ? "pdf" : "jpg";
  const bytes = bytesDe(semilla);
  storage.set(`${rid}/${id}.${ext}`, bytes);
  db.archivos.push({
    id,
    rendicion_id: rid,
    ruta: `${rid}/${id}.${ext}`,
    tipo_mime: mime,
    tamano: bytes.length,
    estado_lectura: "pendiente",
    procesando_desde: null,
    intentos: 0,
    error: null,
    drive_id: null,
    drive_md5: null,
  });
  // La fila que deja la app al subir, con lo heredado.
  db.comprobantes.push({
    ...comprobanteVacio(),
    id: `c-${id}`,
    rendicion_id: rid,
    archivo_id: id,
    proyecto_id: 1,
    area_id: 3,
    solicitante: "Ana Pérez",
    creado_por: "ana",
    creado_en: new Date().toISOString(),
    ...placeholder,
  });
}

sim.gemini.responder = (mime) =>
  mime === "application/pdf"
    ? [
      {
        pagina: 1,
        tipo: "FACTURA",
        serie: "F001",
        numero: "6384",
        fecha: "2026-10-21",
        ruc: "20512345678",
        proveedor: "Sodimac S.A.",
        total: 120,
        moneda: "PEN",
        concepto: "HERRAMIENTAS",
        descripcion: "pernos",
        persona: "",
      },
      {
        pagina: 2,
        tipo: "DJ",
        serie: "",
        numero: "",
        fecha: "2026-10-22",
        ruc: "",
        proveedor: "Ana Pérez",
        total: 8,
        moneda: "PEN",
        concepto: "VIATICOS",
        descripcion: "mototaxi",
        persona: "Ana Pérez",
      },
    ]
    : [
      {
        pagina: 1,
        tipo: "BOLETA",
        serie: "eb01",
        numero: "000135",
        fecha: "2026-10-20",
        ruc: "10456789012",
        proveedor: "Pollería El Rey",
        total: 45.5,
        moneda: "PEN",
        concepto: "viáticos",
        descripcion: "cena",
        persona: "",
      },
    ];

const fila = (id: string) => db.comprobantes.find((c) => c.id === id)!;
const archivo = (id: string) => db.archivos.find((a) => a.id === id)!;
const enDrive = () => [...sim.drive.archivos.values()];

// --- Lectura -------------------------------------------------------------------

Deno.test("leer: el flujo de lectura con la función real", async (t) => {
  subido("a1", "r1", "image/jpeg", 1, { descripcion: "LO QUE ESCRIBIÓ ANA" });
  subido("a2", "r1", "application/pdf", 2);

  await t.step("sin sesión o sobre lo ajeno, no lee", async () => {
    assertEquals((await llamar(leer, null, { archivo_id: "a1" })).status, 401);
    assertEquals((await llamar(leer, "t-beto", { archivo_id: "a1" })).status, 403);
    assertEquals(sim.gemini.llamadas.length, 0);
  });

  await t.step("una foto: llena lo vacío y respeta lo escrito", async () => {
    const r = await llamar(leer, "t-ana", { archivo_id: "a1" });
    assertEquals(r, { status: 200, cuerpo: { ok: true, comprobantes: 1 } });
    const c = fila("c-a1");
    assertEquals([c.tipo_comprobante_id, c.serie, c.numero, c.ruc, c.proveedor, c.total, c.concepto_id], [
      "BOLETA",
      "EB01",
      "135",
      "10456789012",
      "POLLERÍA EL REY",
      45.5,
      10,
    ]);
    assertEquals(c.descripcion, "LO QUE ESCRIBIÓ ANA");
    assertEquals(c.via, "ia");
    assert((c.confianza as { campos: string[] }).campos.includes("fecha"));
    assertEquals(archivo("a1").estado_lectura, "leido");
    assertEquals(sim.gemini.llamadas[0].mime, "image/jpeg");
    assertMatch(sim.gemini.llamadas[0].prompt, /MEMO DE VIÁTICOS/);
  });

  await t.step("pedirla otra vez no vuelve a gastar IA", async () => {
    const antes = sim.gemini.llamadas.length;
    assertEquals((await llamar(leer, "t-ana", { archivo_id: "a1" })).cuerpo, { ok: true, ya: true });
    assertEquals(sim.gemini.llamadas.length, antes);
  });

  await t.step("un PDF de dos páginas da dos filas; la segunda hereda", async () => {
    const r = await llamar(leer, "t-ana", { archivo_id: "a2" });
    assertEquals(r.cuerpo, { ok: true, comprobantes: 2 });
    const filas = db.comprobantes.filter((c) => c.archivo_id === "a2").sort((a, b) =>
      Number(a.pagina) - Number(b.pagina)
    );
    assertEquals(filas.length, 2);
    assertEquals([filas[0].pagina, filas[0].tipo_comprobante_id, filas[0].total], [1, "FACTURA", 120]);
    assertEquals([filas[1].pagina, filas[1].tipo_comprobante_id, filas[1].proyecto_id, filas[1].creado_por], [
      2,
      "DJ",
      1,
      "ana",
    ]);
  });

  await t.step("si la IA falla, queda «fallido» con el motivo y se puede reintentar", async () => {
    subido("a3", "r1", "image/jpeg", 3);
    const responder = sim.gemini.responder;
    sim.gemini.responder = () => 503;
    const r = await llamar(leer, "t-ana", { archivo_id: "a3" });
    assertEquals(r.status, 502);
    assertEquals(archivo("a3").estado_lectura, "fallido");
    assertMatch(String(archivo("a3").error), /503/);
    sim.gemini.responder = responder;
    assertEquals((await llamar(leer, "t-ana", { archivo_id: "a3" })).status, 200);
    assertEquals(archivo("a3").estado_lectura, "leido");
    assertEquals(archivo("a3").intentos, 2);
  });

  await t.step("una foto sin comprobante queda leída, con el aviso", async () => {
    subido("a4", "r1", "image/jpeg", 4);
    const responder = sim.gemini.responder;
    sim.gemini.responder = () => [];
    assertEquals((await llamar(leer, "t-ana", { archivo_id: "a4" })).cuerpo, { ok: true, comprobantes: 0 });
    assertMatch(String(archivo("a4").error), /No se reconoció/);
    sim.gemini.responder = responder;
    // Ana la descarta: no va a la hoja.
    fila("c-a4").descartado = true;
  });
});

// --- Drive -------------------------------------------------------------------

Deno.test("drive: del envío al archivo verificado", async (t) => {
  const r1 = db.rendiciones.find((r) => r.id === "r1")!;

  await t.step("abierta no se publica; sin conexión, avisa", async () => {
    assertMatch((await llamar(drive, "t-ana", { accion: "publicar", rendicion_id: "r1" })).cuerpo.error, /al enviarla/);
    Object.assign(r1, { estado: "enviada", version: 1 });
    const r = await llamar(drive, "t-ana", { accion: "publicar", rendicion_id: "r1" });
    assertEquals(r.status, 409);
    assertMatch(r.cuerpo.error, /no está conectado/);
  });

  await t.step("conectar: solo administración, y con la unidad compartida", async () => {
    assertEquals((await llamar(drive, "t-ana", { accion: "estado" })).status, 403);
    assertEquals((await llamar(drive, "t-tomas", { accion: "estado" })).cuerpo, {
      conectado: false,
      unidad: "InroScan · Rendiciones",
    });
    assertEquals(
      (await llamar(drive, "t-ana", { accion: "conectar", code: "codigo-bueno", redirect_uri: "x" })).status,
      403,
    );
    assertEquals(
      (await llamar(drive, "t-tomas", { accion: "conectar", code: "codigo-malo", redirect_uri: "x" })).status,
      502,
    );
    const unidades = sim.drive.unidades;
    sim.drive.unidades = [];
    const sinUnidad = await llamar(drive, "t-tomas", { accion: "conectar", code: "codigo-bueno", redirect_uri: "x" });
    assertEquals(sinUnidad.status, 404);
    assertMatch(sinUnidad.cuerpo.error, /Créala/);
    sim.drive.unidades = unidades;
    const ok = await llamar(drive, "t-tomas", { accion: "conectar", code: "codigo-bueno", redirect_uri: "x" });
    assertEquals(ok.cuerpo, { conectado: true, cuenta: "t.donoso@inroprin.com", unidad: "InroScan · Rendiciones" });
    assertEquals((db.integraciones[0].datos as { refresh_token: string }).refresh_token, "refresh-ok");
    assertEquals((await llamar(drive, "t-tomas", { accion: "estado" })).cuerpo.conectado, true);
  });

  await t.step("otra persona no publica lo ajeno", async () => {
    assertEquals((await llamar(drive, "t-beto", { accion: "publicar", rendicion_id: "r1" })).status, 403);
  });

  await t.step("enviar v1: carpeta, imágenes verificadas, hoja y PDF", async () => {
    const r = await llamar(drive, "t-ana", { accion: "publicar", rendicion_id: "r1" });
    assertEquals(r.status, 200);
    // Carpetas: Memos / Ana Pérez / Memo 675-2026 / Comprobantes, dentro de la unidad.
    const carpeta = (nombre: string) => enDrive().find((a) => a.name === nombre && a.mimeType.endsWith("folder"))!;
    assertEquals(carpeta("Memos").parents, ["unidad-1"]);
    assertEquals(carpeta("Ana Pérez").parents, [carpeta("Memos").id]);
    assertEquals(carpeta("Memo 675-2026").parents, [carpeta("Ana Pérez").id]);
    assertEquals(carpeta("Comprobantes").parents, [carpeta("Memo 675-2026").id]);
    assertEquals(r1.drive_carpeta_id, carpeta("Memo 675-2026").id);
    assertEquals(sim.drive.permisos, [{
      archivo: carpeta("Memo 675-2026").id,
      correo: "ana@inroprin.com",
      rol: "reader",
    }]);

    // Cada imagen, idéntica byte a byte, con un nombre que se entiende.
    for (const id of ["a1", "a2", "a3", "a4"]) {
      const a = archivo(id);
      const copia = sim.drive.archivos.get(String(a.drive_id))!;
      assertEquals(copia.parents, [carpeta("Comprobantes").id]);
      assertEquals(copia.bytes, storage.get(String(a.ruta)));
      assertEquals(a.drive_md5, await sim.md5(copia.bytes));
    }
    assertEquals(
      sim.drive.archivos.get(String(archivo("a1").drive_id))!.name,
      "2026-10-20 Boleta EB01-135 POLLERÍA EL REY.jpg",
    );

    // La hoja (convertida a Google Sheets) y su PDF, en la carpeta de la rendición.
    const hoja = enDrive().find((a) => a.mimeType === "application/vnd.google-apps.spreadsheet")!;
    assertEquals(hoja.name, "Memo 675-2026 · v1");
    assertEquals(hoja.parents, [carpeta("Memo 675-2026").id]);
    const pdf = enDrive().find((a) => a.name === "Memo 675-2026 · v1.pdf")!;
    assertMatch(new TextDecoder().decode(pdf.bytes), /^%PDF/);
    const v = db.versiones.find((x) => x.rendicion_id === "r1" && x.numero === 1)!;
    assertEquals([v.hoja_id, v.pdf_drive_id], [hoja.id, pdf.id]);
    // 45.50 (a1) + 120 + 8 (a2: factura y DJ) + 45.50 (a3); la DJ no sustenta y a4 está descartado.
    assertEquals([v.total, v.sustentado], [219, 211]);

    // Lo que dice la hoja.
    const { default: ExcelJS } = await import("npm:exceljs@4.4.0");
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(hoja.bytes.buffer as ArrayBuffer);
    const h = libro.getWorksheet("Rendición")!;
    assertEquals(h.getRow(1).cellCount, 14);
    assertEquals(h.rowCount, 6); // títulos + 4 comprobantes + total (el descartado no va)
    const n = h.getCell("G2").value as { text: string; hyperlink: string };
    assertEquals(n, { text: "EB01-135", hyperlink: `https://drive.prueba/${archivo("a1").drive_id}` });
    assertEquals((h.getCell("N6").value as { formula: string }).formula, "SUM(N2:N5)");
    const resumen = libro.getWorksheet("Resumen")!;
    assertEquals(resumen.getCell("B2").value, "Ana Pérez");
    assertEquals((resumen.getCell("B7").value as { formula: string }).formula.split("+").length, 3); // DJ fuera
  });

  await t.step("pedirlo dos veces no duplica nada", async () => {
    const antes = enDrive().length;
    assertEquals((await llamar(drive, "t-ana", { accion: "publicar", rendicion_id: "r1" })).status, 200);
    assertEquals(enDrive().length, antes);
  });

  await t.step("una copia que llega distinta no se da por buena", async () => {
    Object.assign(r1, { estado: "observada" });
    subido("a5", "r1", "image/jpeg", 5);
    fila("c-a5").total = 10;
    Object.assign(r1, { estado: "enviada", version: 2 });
    sim.drive.danarProxima = true;
    const r = await llamar(drive, "t-ana", { accion: "publicar", rendicion_id: "r1" });
    assertEquals(r.status, 500);
    assertMatch(r.cuerpo.error, /no coincide/);
    assertEquals(archivo("a5").drive_id, null);
    const usadas = new Set(db.archivos.map((a) => a.drive_id));
    const imagenes = enDrive().filter((x) => x.mimeType === "image/jpeg");
    assertEquals(imagenes.filter((x) => x.trashed).length, 1, "la copia dañada va a la papelera");
    assertEquals(imagenes.filter((x) => !x.trashed && !usadas.has(x.id)).length, 0, "y no queda ninguna imagen suelta");
    assertEquals(db.versiones.filter((x) => x.rendicion_id === "r1").length, 1);
  });

  await t.step("reenviar v2: solo sube lo nuevo y deja su propia hoja", async () => {
    const imagenesAntes = enDrive().filter((a) => a.mimeType === "image/jpeg" && !a.trashed).length;
    assertEquals((await llamar(drive, "t-ana", { accion: "publicar", rendicion_id: "r1" })).status, 200);
    assertEquals(enDrive().filter((a) => a.mimeType === "image/jpeg" && !a.trashed).length, imagenesAntes + 1); // solo a5
    assert(archivo("a5").drive_id);
    assert(enDrive().some((a) => a.name === "Memo 675-2026 · v2"));
    assert(enDrive().some((a) => a.name === "Memo 675-2026 · v2.pdf"));
    assertEquals(db.versiones.filter((x) => x.rendicion_id === "r1").length, 2);
  });

  await t.step("aprobada: borra de Supabase solo lo verificado en Drive", async () => {
    Object.assign(r1, { estado: "aprobada" });
    // Alguien mandó a la papelera la copia de a3: esa imagen se queda en Supabase.
    sim.drive.archivos.get(String(archivo("a3").drive_id))!.trashed = true;
    const r = await llamar(drive, "t-tomas", { accion: "publicar", rendicion_id: "r1" });
    assertEquals(r.cuerpo.archivadas, 4);
    for (const id of ["a1", "a2", "a4", "a5"]) {
      assertEquals(archivo(id).ruta, null);
      assertEquals(storage.has(`r1/${id}.${id === "a2" ? "pdf" : "jpg"}`), false);
    }
    assertEquals(archivo("a3").ruta, "r1/a3.jpg");
    assert(storage.has("r1/a3.jpg"));
  });

  await t.step("una caja chica va a Cajas / Caja 03 / Reposición 7", async () => {
    db.cajas.push({ id: 7, numero: "03" });
    db.rendiciones.push(
      rendicion("r2", {
        tipo: "caja",
        caja_id: 7,
        correlativo: 7,
        numero_memo: null,
        estado: "enviada",
        version: 1,
        responsable_id: "tomas",
      }),
    );
    subido("a6", "r2", "image/jpeg", 6);
    assertEquals((await llamar(drive, "t-tomas", { accion: "publicar", rendicion_id: "r2" })).status, 200);
    const reposicion = enDrive().find((a) => a.name === "Reposición 7")!;
    const caja = enDrive().find((a) => a.id === reposicion.parents[0])!;
    assertEquals([caja.name, enDrive().find((a) => a.id === caja.parents[0])!.name], ["Caja 03", "Cajas"]);
    assert(enDrive().some((a) => a.name === "Caja 03 · Reposición 7 · v1"));
  });

  await t.step("si se revoca el acceso a Drive, lo dice claro", async () => {
    sim.drive.refresh = "otro";
    const r = await llamar(drive, "t-tomas", { accion: "publicar", rendicion_id: "r2" });
    assertEquals(r.status, 502);
    assertMatch(r.cuerpo.error, /vuelve a conectarla/);
    sim.drive.refresh = "refresh-ok";
  });
});

Deno.test("leer: una rendición enviada ya no se lee", async () => {
  assertEquals((await llamar(leer, "t-ana", { archivo_id: "a3" })).status, 409);
});
