// La rendición en Drive, dentro de la carpeta madre que elige administración.
//
// - conectar: administración conecta una cuenta de Google una vez y elige la
//   carpeta madre; se guarda su token de larga duración (tabla integraciones,
//   solo el sistema la lee).
// - estado: si hay conexión, con qué cuenta y en qué carpeta.
// - publicar: al enviar (y al reenviar) copia las imágenes nuevas a la carpeta
//   de la rendición y genera la hoja y el PDF de esa versión; al aprobar,
//   verifica cada copia y recién entonces borra la imagen de Supabase.
//
// Secretos (Supabase → Edge Functions → Secrets): GOOGLE_CLIENT_SECRET; y
// opcionalmente GOOGLE_CLIENT_ID.

import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { crypto as cripto } from "jsr:@std/crypto@1.0.5";
import { encodeHex } from "jsr:@std/encoding@1.0.10/hex";
import { canjearCodigo, correoDe, Drive, ErrorDeGoogle, tokenDeAcceso } from "./google.ts";
import {
  armarHoja,
  type Catalogos,
  type Comprobante,
  nombreDeImagen,
  type Rendicion,
  rutaDeCarpeta,
  titulo,
  xlsx,
} from "./hoja.ts";

const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ||
  "951030676058-igp95ct69p03lcpt02vtjs79t5dmsrij.apps.googleusercontent.com";
/** Pasado esto, una versión que quedó a medio generar se puede volver a intentar. */
const PLAZO_MS = 5 * 60_000;
const CERRADAS = ["aprobada", "repuesta", "liquidada"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

class Rechazo extends Error {
  constructor(public status: number, mensaje: string) {
    super(mensaje);
  }
}

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Conexion = {
  refresh_token: string;
  cuenta: string;
  carpeta_id: string;
  carpeta_nombre: string;
  /** La unidad compartida donde vive la carpeta madre, si vive en una. */
  unidad_id: string | null;
};

const enlaceDe = (id: string) => `https://drive.google.com/drive/folders/${id}`;

function secreto(): string {
  const s = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!s) throw new Rechazo(409, "Falta configurar GOOGLE_CLIENT_SECRET en los secretos de Supabase.");
  return s;
}

async function conexion(): Promise<Conexion | null> {
  const { data } = await db.from("integraciones").select("datos").eq("clave", "drive").maybeSingle();
  return (data?.datos as Conexion) ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return responder(405, { error: "Solo POST." });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: quien } = await db.auth.getUser(token);
    if (!quien?.user) throw new Rechazo(401, "Tu sesión venció. Vuelve a entrar.");
    const { data: persona } = await db.from("personas").select("es_administracion, activo").eq("id", quien.user.id)
      .maybeSingle();
    if (!persona?.activo) throw new Rechazo(403, "Tu cuenta no está habilitada.");
    const cuerpo = await req.json();

    if (cuerpo.accion === "estado") {
      if (!persona.es_administracion) throw new Rechazo(403, "Solo administración.");
      const c = await conexion();
      return responder(
        200,
        c
          ? { conectado: true, cuenta: c.cuenta, carpeta: c.carpeta_nombre, enlace: enlaceDe(c.carpeta_id) }
          : { conectado: false },
      );
    }

    if (cuerpo.accion === "conectar") {
      if (!persona.es_administracion) throw new Rechazo(403, "Solo administración conecta Drive.");
      if (!cuerpo.carpeta) throw new Rechazo(400, "Falta indicar la carpeta madre.");
      const t = await canjearCodigo(fetch, {
        code: String(cuerpo.code),
        redirect_uri: String(cuerpo.redirect_uri),
        client_id: CLIENT_ID,
        client_secret: secreto(),
      });
      if (!t.refresh_token) {
        throw new Rechazo(400, "Google no entregó un acceso duradero. Vuelve a conectar y acepta todos los permisos.");
      }
      const cuenta = await correoDe(fetch, t.access_token);
      const madre = await new Drive(fetch, t.access_token).carpetaMadre(String(cuerpo.carpeta));
      const datos: Conexion = {
        refresh_token: t.refresh_token,
        cuenta,
        carpeta_id: madre.id,
        carpeta_nombre: madre.name,
        unidad_id: madre.driveId,
      };
      const { error } = await db.from("integraciones").upsert({
        clave: "drive",
        datos,
        actualizado_en: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      return responder(200, { conectado: true, cuenta, carpeta: madre.name, enlace: enlaceDe(madre.id) });
    }

    if (cuerpo.accion === "publicar") {
      return responder(200, await publicar(String(cuerpo.rendicion_id), quien.user.id, !!persona.es_administracion));
    }
    throw new Rechazo(400, "Acción desconocida.");
  } catch (e) {
    const mensaje = (e as Error).message || "Error desconocido.";
    if (e instanceof Rechazo) return responder(e.status, { error: mensaje });
    console.error("drive", e);
    return responder(e instanceof ErrorDeGoogle ? 502 : 500, { error: mensaje });
  }
});

async function publicar(rendicionId: string, uid: string, esAdmin: boolean) {
  const { data: r } = await db
    .from("rendiciones")
    .select("*, caja:cajas(numero), responsable:personas(nombre, correo)")
    .eq("id", rendicionId)
    .maybeSingle();
  if (!r) throw new Rechazo(404, "No existe esa rendición.");
  if (r.responsable_id !== uid && !esAdmin) throw new Rechazo(403, "No tienes permiso sobre esa rendición.");
  if (r.estado === "abierta") throw new Rechazo(409, "Se publica en Drive al enviarla.");

  const c = await conexion();
  if (!c) throw new Rechazo(409, "Drive no está conectado todavía.");
  const drive = new Drive(
    fetch,
    await tokenDeAcceso(fetch, { refresh_token: c.refresh_token, client_id: CLIENT_ID, client_secret: secreto() }),
  );
  const responsable = r.responsable?.nombre || r.responsable?.correo || "";

  // 1. La carpeta de la rendición (una vez), compartida con quien rinde.
  let carpeta: string = r.drive_carpeta_id;
  if (!carpeta) {
    carpeta = c.carpeta_id;
    for (const nombre of rutaDeCarpeta(r as Rendicion, r.caja, responsable)) {
      carpeta = await drive.carpeta(nombre, carpeta, c.unidad_id);
    }
    await db.from("rendiciones").update({ drive_carpeta_id: carpeta }).eq("id", r.id);
    if (r.responsable?.correo) {
      await drive.compartir(carpeta, r.responsable.correo).catch((e) => console.error("compartir", e));
    }
  }

  const [{ data: filas }, { data: archivos }, catalogos] = await Promise.all([
    db.from("comprobantes").select("*").eq("rendicion_id", r.id),
    db.from("archivos").select("id, ruta, tipo_mime, tamano, drive_id, drive_md5").eq("rendicion_id", r.id),
    leerCatalogos(),
  ]);
  const comprobantes = (filas ?? []) as Comprobante[];

  // 2. Las imágenes que todavía no están en Drive. Se anota la huella MD5 que
  //    devuelve Drive solo si coincide con la de los bytes enviados.
  const imagenes = await drive.carpeta("Comprobantes", carpeta, c.unidad_id);
  const enlaces = new Map<string, string>();
  for (const a of archivos ?? []) {
    if (a.drive_id) {
      enlaces.set(a.id, `https://drive.google.com/file/d/${a.drive_id}/view`);
      continue;
    }
    if (!a.ruta) continue;
    const { data: blob } = await db.storage.from("comprobantes").download(a.ruta);
    if (!blob) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const md5 = encodeHex(await cripto.subtle.digest("MD5", bytes));
    const primero = comprobantes.filter((x) => x.archivo_id === a.id).sort((x, y) => x.pagina - y.pagina)[0];
    const ext = a.tipo_mime === "application/pdf"
      ? "pdf"
      : a.tipo_mime.split("/")[1] === "jpeg"
      ? "jpg"
      : a.tipo_mime.split("/")[1];
    const subido = await drive.subir(
      nombreDeImagen(primero, a.id, ext),
      imagenes,
      new Blob([bytes], { type: a.tipo_mime }),
      a.tipo_mime,
    );
    if (subido.md5Checksum !== md5) {
      // Una copia distinta del original no se usa ni se deja suelta en la carpeta.
      await drive.papelera(subido.id).catch((e) => console.error("papelera", e));
      throw new Error(`La copia en Drive de ${a.id} no coincide con el original.`);
    }
    await db.from("archivos").update({ drive_id: subido.id, drive_md5: md5 }).eq("id", a.id);
    enlaces.set(a.id, subido.webViewLink);
  }

  // 3. La hoja y el PDF de la versión enviada, una sola vez por versión.
  let hoja: string | null = null;
  let pdf: string | null = null;
  if (r.version > 0 && (await tomarVersion(r, comprobantes))) {
    const h = armarHoja({
      rendicion: r as Rendicion,
      caja: r.caja,
      administrador: responsable,
      comprobantes,
      catalogos,
      enlaces,
    });
    const nombre = `${titulo(r as Rendicion, r.caja)} · v${r.version}`;
    const bytes = await xlsx(h, {
      titulo: titulo(r as Rendicion, r.caja),
      responsable,
      estado: r.estado,
      version: r.version,
      recibido: Number(r.monto),
      tipo: r.tipo,
    });
    const subida = await drive.subir(nombre, carpeta, new Blob([bytes as Uint8Array<ArrayBuffer>]), "", true);
    hoja = subida.id;
    const archivoPdf = await drive.subir(`${nombre}.pdf`, carpeta, await drive.pdf(subida.id), "application/pdf");
    pdf = archivoPdf.id;
    await db.from("versiones").update({ hoja_id: hoja, pdf_drive_id: pdf, generado_en: new Date().toISOString() })
      .eq("rendicion_id", r.id).eq("numero", r.version);
  }

  // 4. Aprobada: cada imagen ya copiada se verifica en Drive y recién ahí se
  //    borra de Supabase.
  let archivadas = 0;
  if (CERRADAS.includes(r.estado)) {
    const { data: copiadas } = await db.from("archivos").select("id, ruta, tamano, drive_id, drive_md5").eq(
      "rendicion_id",
      r.id,
    )
      .not("drive_id", "is", null).not("ruta", "is", null);
    for (const a of copiadas ?? []) {
      const enDrive = await drive.datos(a.drive_id);
      if (enDrive.trashed || enDrive.md5Checksum !== a.drive_md5 || Number(enDrive.size) !== a.tamano) continue;
      const { error } = await db.storage.from("comprobantes").remove([a.ruta]);
      if (error) continue;
      await db.from("archivos").update({ ruta: null }).eq("id", a.id);
      archivadas++;
    }
  }
  return { ok: true, carpeta, hoja, pdf, archivadas };
}

/**
 * Reserva la versión para generarla. Devuelve falso si ya existe (o la está
 * generando otro pedido): dos clics no producen dos hojas.
 */
async function tomarVersion(
  r: { id: string; version: number; monto: unknown; no_sustentan: string[] | null },
  comprobantes: Comprobante[],
): Promise<boolean> {
  const { data: existe } = await db.from("versiones").select("id, hoja_id, generado_en").eq("rendicion_id", r.id).eq(
    "numero",
    r.version,
  ).maybeSingle();
  if (existe?.hoja_id) return false;
  if (existe) {
    // Quedó a medio camino: se retoma solo si pasó el plazo.
    const vencido = new Date(Date.now() - PLAZO_MS).toISOString();
    const { data } = await db.from("versiones").update({ generado_en: new Date().toISOString() }).eq("id", existe.id)
      .lt("generado_en", vencido).select("id");
    return !!data?.length;
  }
  const vigentes = comprobantes.filter((c) => !c.descartado && c.moneda !== "USD");
  const fuera = new Set(r.no_sustentan ?? []);
  const suma = (l: Comprobante[]) => Math.round(l.reduce((s, c) => s + Number(c.total ?? 0), 0) * 100) / 100;
  const { error } = await db.from("versiones").insert({
    rendicion_id: r.id,
    numero: r.version,
    total: suma(vigentes),
    sustentado: suma(vigentes.filter((c) => c.tipo_comprobante_id && !fuera.has(c.tipo_comprobante_id))),
    datos: { rendicion: r, comprobantes: comprobantes.filter((c) => !c.descartado) },
  });
  return !error; // un choque de la clave única es otro pedido que llegó primero
}

async function leerCatalogos(): Promise<Catalogos> {
  const [e, a, p, c, t] = await Promise.all([
    db.from("empresas").select("id, nombre"),
    db.from("areas").select("id, nombre"),
    db.from("proyectos").select("id, nombre"),
    db.from("conceptos").select("id, nombre"),
    db.from("tipos_comprobante").select("id, nombre, sustenta"),
  ]);
  return {
    empresas: e.data ?? [],
    areas: a.data ?? [],
    proyectos: p.data ?? [],
    conceptos: c.data ?? [],
    tipos: t.data ?? [],
  };
}
