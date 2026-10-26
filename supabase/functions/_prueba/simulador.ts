/**
 * Un Supabase, un Gemini y un Google Drive de mentira, en memoria, para correr
 * el código real de las funciones «leer» y «drive» de punta a punta sin red.
 *
 * Imita lo que esas funciones usan, con la forma real de cada pedido:
 * PostgREST (filtros, `or`, embebidos, insert/upsert/update), Storage
 * (descargar y borrar), la sesión (auth/v1/user), el token de Google, la
 * unidad compartida, carpetas, subidas multipart/related, conversión a hoja,
 * exportación a PDF, permisos y Gemini.
 *
 * Las carpetas que empiezan con «_» no se despliegan como funciones.
 */

import { crypto as cripto } from "jsr:@std/crypto@1.0.5";
import { encodeHex } from "jsr:@std/encoding@1.0.10/hex";

export const SUPABASE = "http://supabase.prueba";

type Fila = Record<string, unknown>;
export type ArchivoDrive = {
  id: string;
  name: string;
  parents: string[];
  mimeType: string;
  bytes: Uint8Array;
  md5?: string;
  trashed?: boolean;
};

const md5 = async (b: Uint8Array) => encodeHex(await cripto.subtle.digest("MD5", b as Uint8Array<ArrayBuffer>));
const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

// Bytes ↔ texto sin perder nada: cada byte es un carácter (latin1).
const aTexto = (b: Uint8Array) => Array.from(b, (x) => String.fromCharCode(x)).join("");
const aBytes = (t: string) => Uint8Array.from(t, (c) => c.charCodeAt(0));

export function simulador() {
  const db: Record<string, Fila[]> = {
    personas: [],
    cajas: [],
    empresas: [{ id: 1, nombre: "INROPRIN", activo: true }],
    areas: [{ id: 3, nombre: "COMERCIAL INROPRIN", activo: true, orden: 2 }],
    proyectos: [{ id: 1, nombre: "PAQ 02 CHINA CIVIL", activo: true }],
    conceptos: [
      { id: 10, nombre: "VIATICOS", categoria: "COMERCIAL", subcategoria: "GASTOS COMERCIALES", activo: true },
      { id: 11, nombre: "HERRAMIENTAS", categoria: "BIENES", subcategoria: "HERRAMIENTAS", activo: true },
    ],
    tipos_comprobante: [
      { id: "FACTURA", nombre: "FACTURA ELECTRONICA", sustenta: true, orden: 1, activo: true },
      { id: "BOLETA", nombre: "BOLETA DE VENTA", sustenta: true, orden: 3, activo: true },
      { id: "DJ", nombre: "DECLARACIÓN JURADA", sustenta: false, orden: 8, activo: true },
    ],
    rendiciones: [],
    comprobantes: [],
    archivos: [],
    versiones: [],
    integraciones: [],
  };
  const storage = new Map<string, Uint8Array>();
  const sesiones = new Map<string, string>(); // token → id de persona
  const drive = {
    archivos: new Map<string, ArchivoDrive>(),
    permisos: [] as { archivo: string; correo: string; rol: string }[],
    unidades: [{ id: "unidad-1", name: "InroScan · Rendiciones" }],
    refresh: "refresh-ok",
    /** Para simular una copia que llega dañada. */
    danarProxima: false,
  };
  const gemini = {
    llamadas: [] as { mime: string; prompt: string }[],
    /** Qué «lee» la IA según el tipo de archivo; o un error HTTP. */
    responder: (_mime: string): unknown[] | number => [],
  };
  const log: string[] = [];
  let n = 0;
  const nuevoId = (p: string) => `${p}-${++n}`;

  // --- PostgREST -----------------------------------------------------------

  function partir(t: string): string[] {
    // Separa por comas de primer nivel, respetando paréntesis y comillas.
    const partes: string[] = [];
    let nivel = 0, comillas = false, actual = "";
    for (const c of t) {
      if (c === '"') comillas = !comillas;
      if (!comillas && c === "(") nivel++;
      if (!comillas && c === ")") nivel--;
      if (!comillas && nivel === 0 && c === ",") {
        partes.push(actual);
        actual = "";
      } else actual += c;
    }
    if (actual) partes.push(actual);
    return partes;
  }

  function cumple(f: Fila, col: string, expr: string): boolean {
    const neg = expr.startsWith("not.");
    if (neg) expr = expr.slice(4);
    const i = expr.indexOf(".");
    const op = expr.slice(0, i);
    const val = expr.slice(i + 1).replace(/^"(.*)"$/, "$1");
    const v = f[col];
    let r: boolean;
    if (op === "eq") r = String(v) === val;
    else if (op === "neq") r = String(v) !== val;
    else if (op === "lt") r = v != null && String(v) < val;
    else if (op === "gte") r = v != null && String(v) >= val;
    else if (op === "lte") r = v != null && String(v) <= val;
    else if (op === "is") r = val === "null" ? v == null : String(v) === val;
    else if (op === "in") {
      r = val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")).includes(String(v));
    } else throw new Error(`operador no simulado: ${op}`);
    return neg ? !r : r;
  }

  function arbol(f: Fila, expr: string, modo: "or" | "and"): boolean {
    const partes = partir(expr.replace(/^\(|\)$/g, ""));
    const res = partes.map((p) => {
      const m = p.match(/^(and|or)\((.*)\)$/);
      if (m) return arbol(f, `(${m[2]})`, m[1] as "or" | "and");
      const i = p.indexOf(".");
      return cumple(f, p.slice(0, i), p.slice(i + 1));
    });
    return modo === "or" ? res.some(Boolean) : res.every(Boolean);
  }

  function filtrar(filas: Fila[], q: URLSearchParams): Fila[] {
    let r = filas;
    for (const [k, v] of q) {
      if (["select", "order", "limit", "offset", "columns", "on_conflict"].includes(k)) continue;
      if (k === "or") r = r.filter((f) => arbol(f, v, "or"));
      else r = r.filter((f) => cumple(f, k, v));
    }
    const orden = q.get("order");
    if (orden) {
      const claves = orden.split(",").map((o) => o.split("."));
      r = [...r].sort((a, b) => {
        for (const [col, dir] of claves) {
          if (a[col] === b[col]) continue;
          return (String(a[col]) > String(b[col]) ? 1 : -1) * (dir === "desc" ? -1 : 1);
        }
        return 0;
      });
    }
    const limite = q.get("limit");
    return limite ? r.slice(0, Number(limite)) : r;
  }

  function proyectar(tabla: string, filas: Fila[], select: string | null): Fila[] {
    return filas.map((f) => {
      const x: Fila = { ...f };
      if (tabla === "rendiciones" && select?.includes("caja:cajas")) {
        const c = db.cajas.find((c) => c.id === f.caja_id);
        x.caja = c ? { numero: c.numero } : null;
      }
      if (tabla === "rendiciones" && select?.includes("responsable:personas")) {
        const p = db.personas.find((p) => p.id === f.responsable_id);
        x.responsable = p ? { nombre: p.nombre, correo: p.correo } : null;
      }
      return x;
    });
  }

  async function postgrest(url: URL, init: RequestInit): Promise<Response> {
    const tabla = url.pathname.split("/").pop()!;
    const t = db[tabla];
    if (!t) return json({ message: `tabla no simulada: ${tabla}` }, 404);
    const metodo = init.method ?? "GET";
    const q = url.searchParams;
    const h = new Headers(init.headers);
    const objeto = (h.get("Accept") ?? "").includes("vnd.pgrst.object");
    const salida = (filas: Fila[], status = 200) => {
      const p = proyectar(tabla, filas, q.get("select"));
      if (objeto) {
        return p.length === 1 ? json(p[0]) : json({
          code: "PGRST116",
          message: "JSON object requested",
          details: `The result contains ${p.length} rows`,
        }, 406);
      }
      return json(p, status);
    };
    if (metodo === "GET") return salida(filtrar(t, q));
    const cuerpo = init.body ? JSON.parse(String(init.body)) : {};
    if (metodo === "POST") {
      const lista: Fila[] = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
      const fusionar = (h.get("Prefer") ?? "").includes("merge-duplicates");
      const creadas: Fila[] = [];
      for (const f of lista) {
        if (tabla === "integraciones") {
          const ya = t.find((x) => x.clave === f.clave);
          if (ya && fusionar) {
            Object.assign(ya, f);
            creadas.push(ya);
            continue;
          }
        }
        if (tabla === "versiones" && t.some((x) => x.rendicion_id === f.rendicion_id && x.numero === f.numero)) {
          return json({
            code: "23505",
            message: 'duplicate key value violates unique constraint "versiones_rendicion_id_numero_key"',
          }, 409);
        }
        const fila: Fila = {
          ...(tabla === "comprobantes" ? comprobanteVacio() : {}),
          ...(tabla === "versiones"
            ? { hoja_id: null, pdf_drive_id: null, generado_en: new Date().toISOString() }
            : {}),
          id: f.id ?? nuevoId(tabla),
          creado_en: new Date(Date.now() + n).toISOString(),
          ...f,
        };
        t.push(fila);
        creadas.push(fila);
        log.push(`db: insertar ${tabla}`);
      }
      return salida(creadas, 201);
    }
    if (metodo === "PATCH") {
      const filas = filtrar(t, q);
      for (const f of filas) Object.assign(f, cuerpo);
      log.push(`db: cambiar ${tabla} (${filas.length}) ${Object.keys(cuerpo).join(",")}`);
      return salida(filas);
    }
    return json({ message: "método no simulado" }, 405);
  }

  // --- Google --------------------------------------------------------------

  function consulta(q: string) {
    const nombre = q.match(/name = '((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    const padre = q.match(/'([^']+)' in parents/)?.[1];
    return { nombre, padre };
  }

  async function google(url: URL, init: RequestInit): Promise<Response> {
    const auth = new Headers(init.headers).get("Authorization");
    if (url.host === "oauth2.googleapis.com") {
      const p = new URLSearchParams(String(init.body));
      if (p.get("grant_type") === "authorization_code") {
        return p.get("code") === "codigo-bueno"
          ? json({ access_token: "acceso", refresh_token: drive.refresh })
          : json({ error: "invalid_grant" }, 400);
      }
      return p.get("refresh_token") === drive.refresh
        ? json({ access_token: "acceso" })
        : json({ error: "invalid_grant" }, 400);
    }
    if (auth !== "Bearer acceso") return json({ error: { message: "Invalid Credentials" } }, 401);
    if (url.host === "openidconnect.googleapis.com") return json({ email: "t.donoso@inroprin.com" });

    const ruta = url.pathname;
    if (ruta === "/drive/v3/drives") {
      const { nombre } = consulta(url.searchParams.get("q") ?? "");
      return json({ drives: drive.unidades.filter((u) => u.name === nombre) });
    }
    if (ruta === "/drive/v3/files" && (init.method ?? "GET") === "GET") {
      const { nombre, padre } = consulta(url.searchParams.get("q") ?? "");
      const files = [...drive.archivos.values()].filter(
        (a) =>
          a.name === nombre && a.parents.includes(padre!) && a.mimeType === "application/vnd.google-apps.folder" &&
          !a.trashed,
      );
      return json({ files: files.map((a) => ({ id: a.id })) });
    }
    if (ruta === "/drive/v3/files" && init.method === "POST") {
      const m = JSON.parse(String(init.body));
      const id = nuevoId("carpeta");
      drive.archivos.set(id, { id, name: m.name, parents: m.parents, mimeType: m.mimeType, bytes: new Uint8Array() });
      log.push(`drive: carpeta «${m.name}»`);
      return json({ id });
    }
    if (ruta === "/upload/drive/v3/files") {
      // multipart/related: metadatos JSON y el contenido, separados por el borde.
      const borde = new Headers(init.headers).get("Content-Type")!.match(/boundary=(.+)$/)![1];
      const texto = aTexto(new Uint8Array(await (init.body as Blob).arrayBuffer()));
      const partes = texto.split(`--${borde}`).slice(1, -1);
      const [, meta] = partes[0].split("\r\n\r\n");
      const [cab, ...resto] = partes[1].split("\r\n\r\n");
      const contenido = aBytes(resto.join("\r\n\r\n").replace(/\r\n$/, ""));
      // Los metadatos viajan en UTF-8 (nombres con tildes, «·», «Reposición»).
      const m = JSON.parse(new TextDecoder().decode(aBytes(meta)));
      const id = nuevoId("archivo");
      const esHoja = m.mimeType === "application/vnd.google-apps.spreadsheet";
      const huella = esHoja ? undefined : await md5(contenido);
      drive.archivos.set(id, {
        id,
        name: m.name,
        parents: m.parents,
        mimeType: m.mimeType ?? cab.match(/Content-Type: (.+)/)![1].trim(),
        bytes: contenido,
        md5: huella,
      });
      log.push(`drive: subir «${m.name}»`);
      const informado = drive.danarProxima && huella ? "00000000000000000000000000000000" : huella;
      drive.danarProxima = false;
      return json({
        id,
        md5Checksum: informado,
        size: String(contenido.length),
        webViewLink: `https://drive.prueba/${id}`,
      });
    }
    const exportar = ruta.match(/^\/drive\/v3\/files\/([^/]+)\/export$/);
    if (exportar) {
      const a = drive.archivos.get(exportar[1]);
      if (a?.mimeType !== "application/vnd.google-apps.spreadsheet") return json({ error: "no es una hoja" }, 400);
      return new Response(new TextEncoder().encode(`%PDF-1.4 simulado de ${a.name}`), {
        headers: { "Content-Type": "application/pdf" },
      });
    }
    const permisos = ruta.match(/^\/drive\/v3\/files\/([^/]+)\/permissions$/);
    if (permisos) {
      const p = JSON.parse(String(init.body));
      drive.permisos.push({ archivo: permisos[1], correo: p.emailAddress, rol: p.role });
      return json({ id: "permiso" });
    }
    const datos = ruta.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (datos && init.method === "PATCH") {
      const a = drive.archivos.get(datos[1]);
      if (!a) return json({}, 404);
      Object.assign(a, JSON.parse(String(init.body)));
      log.push(`drive: papelera «${a.name}»`);
      return json({ id: a.id });
    }
    if (datos) {
      const a = drive.archivos.get(datos[1]);
      return a ? json({ md5Checksum: a.md5, size: String(a.bytes.length), trashed: !!a.trashed }) : json({}, 404);
    }
    return json({ error: `Google no simulado: ${ruta}` }, 404);
  }

  async function geminiFalso(init: RequestInit): Promise<Response> {
    const cuerpo = JSON.parse(String(init.body));
    const partes = cuerpo.contents[0].parts;
    const mime = partes[1].inline_data.mime_type;
    gemini.llamadas.push({ mime, prompt: partes[0].text });
    if (!partes[1].inline_data.data) return json({ error: "sin imagen" }, 400);
    const r = gemini.responder(mime);
    if (typeof r === "number") return json({ error: { message: "simulado" } }, r);
    return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(r) }] } }] });
  }

  // --- El fetch de todo ----------------------------------------------------

  async function pedir(entrada: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
    if (entrada instanceof Request) {
      init = {
        method: entrada.method,
        headers: entrada.headers,
        body: entrada.body ? await entrada.text() : undefined,
        ...init,
      };
    }
    if (url.origin === SUPABASE) {
      if (url.pathname.startsWith("/rest/v1/")) return postgrest(url, init);
      if (url.pathname === "/auth/v1/user") {
        const token = new Headers(init.headers).get("Authorization")?.replace("Bearer ", "") ?? "";
        const id = sesiones.get(token);
        return id
          ? json({ id, aud: "authenticated", email: db.personas.find((p) => p.id === id)?.correo })
          : json({ msg: "invalid JWT" }, 401);
      }
      if (url.pathname.startsWith("/storage/v1/object/")) {
        const ruta = decodeURIComponent(
          url.pathname.replace(/^\/storage\/v1\/object\/(authenticated\/)?comprobantes\/?/, ""),
        );
        if ((init.method ?? "GET") === "DELETE") {
          const { prefixes } = JSON.parse(String(init.body));
          for (const p of prefixes) storage.delete(p);
          log.push(`storage: borrar ${prefixes.join(",")}`);
          return json(prefixes.map((name: string) => ({ name })));
        }
        const b = storage.get(ruta);
        return b
          ? new Response(b as Uint8Array<ArrayBuffer>)
          : json({ error: "not_found", message: "Object not found" }, 404);
      }
    }
    if (url.host === "generativelanguage.googleapis.com") return geminiFalso(init);
    if (url.host.endsWith("googleapis.com")) return google(url, init);
    throw new Error(`Pedido sin simular: ${url}`);
  }

  return { db, storage, sesiones, drive, gemini, log, pedir, md5 };
}

export function comprobanteVacio(): Fila {
  return {
    archivo_id: null,
    pagina: 1,
    client_id: null,
    fecha: null,
    tipo_comprobante_id: null,
    serie: "",
    numero: "",
    ruc: "",
    proveedor: "",
    proyecto_id: null,
    area_id: null,
    solicitante: "",
    concepto_id: null,
    descripcion: "",
    total: null,
    moneda: "PEN",
    via: null,
    confianza: {},
    descartado: false,
    motivo_descarte: "",
    observacion: "",
  };
}

/** Carga una función real: su Deno.serve queda capturado en vez de abrir un puerto. */
export async function cargarFuncion(ruta: string): Promise<(r: Request) => Promise<Response>> {
  let manejador: ((r: Request) => Promise<Response>) | null = null;
  const original = Deno.serve;
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = (h: (r: Request) => Promise<Response>) => {
    manejador = h;
    return { finished: Promise.resolve(), shutdown: () => Promise.resolve() };
  };
  await import(ruta);
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = original;
  if (!manejador) throw new Error(`${ruta} no llamó a Deno.serve`);
  return manejador;
}
