"use client";

import type { Herencia } from "./comprobante";
import { FallaDeBase } from "./errores-de-base";
import { supabase } from "./supabase";

/**
 * De una foto o un PDF a una fila leída: se achica, se sube a Supabase, se
 * anota y se pide su lectura. La lectura corre en el servidor (función
 * «leer»), no en el teléfono.
 */

/** Lado mayor de una foto subida. Más no lee mejor y pesa el triple. */
export const LADO_MAXIMO = 2000;
/** El límite del bucket «comprobantes». */
export const PESO_MAXIMO = 10 * 1024 * 1024;

export function medidaReducida(ancho: number, alto: number, max = LADO_MAXIMO) {
  const f = Math.min(1, max / Math.max(ancho, alto));
  return { ancho: Math.round(ancho * f), alto: Math.round(alto * f) };
}

export const esPdf = (f: { type: string; name: string }) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

export type Preparado = { blob: Blob; mime: string; ext: string };

/** Las fotos se achican y pasan a JPEG; los PDF van tal cual. */
export async function preparar(f: File): Promise<Preparado> {
  if (esPdf(f)) {
    if (f.size > PESO_MAXIMO) throw new Error("El PDF pesa más de 10 MB. Divídelo o escanéalo con menos resolución.");
    return { blob: f, mime: "application/pdf", ext: "pdf" };
  }
  let img: ImageBitmap;
  try {
    // Respeta la orientación de la foto (EXIF): una foto de costado se lee mal.
    img = await createImageBitmap(f);
  } catch {
    throw new Error("No se reconoce esa imagen. Usa una foto (JPG o PNG) o un PDF.");
  }
  const { ancho, alto } = medidaReducida(img.width, img.height);
  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  lienzo.getContext("2d")!.drawImage(img, 0, 0, ancho, alto);
  img.close();
  const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, "image/jpeg", 0.85));
  if (!blob) throw new Error("No se pudo preparar la imagen.");
  return { blob, mime: "image/jpeg", ext: "jpg" };
}

async function huella(blob: Blob): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function mensajeDeStorage(e: { message?: string; statusCode?: string | number }): string {
  const m = e.message ?? "";
  if (/failed to fetch|networkerror|load failed/i.test(m)) return "Sin conexión. Revisa tu internet e inténtalo de nuevo.";
  if (/maximum allowed size|too large/i.test(m)) return "El archivo pesa más de 10 MB.";
  if (/mime type/i.test(m)) return "Ese tipo de archivo no se acepta: usa una foto o un PDF.";
  if (/row-level security|unauthorized|403/i.test(m)) return "No tienes permiso para subir a esta rendición.";
  return m || "No se pudo subir el archivo.";
}

/**
 * Sube el archivo y deja una fila esperando su lectura, con lo que se hereda
 * de las anteriores. Devuelve el id del archivo.
 */
export async function subir(rendicionId: string, f: File, base: Herencia): Promise<string> {
  return subirPreparado(rendicionId, await preparar(f), base);
}

export async function subirPreparado(rendicionId: string, { blob, mime, ext }: Preparado, base: Herencia): Promise<string> {
  const db = supabase();
  const firma = await huella(blob);

  // Antes de subir: la misma foto dos veces es un error de captura, y subirla
  // igual dejaría una copia huérfana en el almacenamiento.
  const ya = await db.from("archivos").select("id").eq("rendicion_id", rendicionId).eq("huella", firma).maybeSingle();
  if (ya.data) throw new Error(YA_SUBIDO);

  const clientId = crypto.randomUUID();
  const ruta = `${rendicionId}/${clientId}.${ext}`;
  const { error: errorSubida } = await db.storage.from("comprobantes").upload(ruta, blob, { contentType: mime });
  if (errorSubida) throw new Error(mensajeDeStorage(errorSubida));

  const archivo = await db
    .from("archivos")
    .insert({ rendicion_id: rendicionId, client_id: clientId, ruta, huella: firma, tipo_mime: mime, tamano: blob.size })
    .select("id")
    .single();
  if (archivo.error) throw new FallaDeBase(archivo.error);

  const fila = await db
    .from("comprobantes")
    .insert({ rendicion_id: rendicionId, archivo_id: archivo.data.id, client_id: crypto.randomUUID(), ...base });
  if (fila.error) throw new FallaDeBase(fila.error);
  return archivo.data.id;
}

/** El error es la falta de señal (vale reintentar), no un problema del archivo. */
export const esSinConexion = (e: unknown) =>
  (typeof navigator !== "undefined" && !navigator.onLine) || /^Sin conexión/.test((e as Error)?.message ?? "");

export const YA_SUBIDO = "Ese archivo ya está subido en esta rendición.";

/** Pide la lectura y espera a que termine (unos segundos por archivo). */
export async function leer(archivoId: string): Promise<void> {
  const { error } = await supabase().functions.invoke("leer", { body: { archivo_id: archivoId } });
  if (!error) return;
  const respuesta = (error as { context?: unknown }).context;
  if (respuesta instanceof Response) {
    const cuerpo = await respuesta.json().catch(() => null);
    throw new Error(cuerpo?.error ?? `La lectura falló (${respuesta.status}).`);
  }
  throw new Error("Sin conexión con el servidor de lectura. Reintenta cuando tengas internet.");
}

/** Enlaces de una hora para ver las imágenes guardadas, en el mismo orden. */
export async function enlacesDeArchivos(rutas: string[]): Promise<string[]> {
  const { data, error } = await supabase().storage.from("comprobantes").createSignedUrls(rutas, 3600);
  if (error || !data) throw new Error(mensajeDeStorage(error ?? {}));
  return data.map((d) => d.signedUrl ?? "");
}
