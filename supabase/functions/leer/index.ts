// Lee un archivo recién subido y llena sus comprobantes.
//
// La llama la app apenas termina de subir una foto o un PDF (o cuando vuelve
// la señal, si se capturó sin conexión). Corre en Supabase y no en el
// teléfono: la clave de la IA no sale del servidor y el teléfono no carga con
// la lectura.
//
// Secretos (Supabase → Edge Functions → Secrets): GEMINI_API_KEY, y
// opcionalmente GEMINI_MODELO. SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los
// pone Supabase.

import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { encodeBase64 } from "jsr:@std/encoding@1.0.10/base64";
import { armarPrompt, type Catalogo, completar, esquema, type Fila, normalizar, textoDeGemini } from "./lectura.ts";

const MODELO = Deno.env.get("GEMINI_MODELO") || "gemini-3.1-flash-lite-preview";
/** Pasado esto, una lectura «procesando» se da por muerta y se puede retomar. */
const PLAZO_MS = 3 * 60_000;

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return responder(405, { error: "Solo POST." });

  let archivoId: string | null = null;
  try {
    // La función no confía en la puerta de enlace: verifica la sesión ella misma.
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: quien } = await db.auth.getUser(token);
    if (!quien?.user) throw new Rechazo(401, "Tu sesión venció. Vuelve a entrar.");

    archivoId = String((await req.json()).archivo_id ?? "");
    const { data: archivo } = await db
      .from("archivos")
      .select("id, rendicion_id, ruta, tipo_mime, estado_lectura, procesando_desde, intentos")
      .eq("id", archivoId)
      .maybeSingle();
    if (!archivo) throw new Rechazo(404, "No existe ese archivo.");

    const [{ data: rendicion }, { data: persona }] = await Promise.all([
      db.from("rendiciones").select("tipo, estado, responsable_id").eq("id", archivo.rendicion_id).single(),
      db.from("personas").select("es_administracion, activo").eq("id", quien.user.id).maybeSingle(),
    ]);
    // Las mismas reglas que puede_editar() en la base.
    const suya = rendicion?.responsable_id === quien.user.id || persona?.es_administracion;
    if (!persona?.activo || !suya) throw new Rechazo(403, "No tienes permiso sobre esa rendición.");
    if (!["abierta", "observada"].includes(rendicion!.estado)) {
      throw new Rechazo(409, "La rendición ya se envió: no se lee nada nuevo.");
    }
    if (archivo.estado_lectura === "leido") return responder(200, { ok: true, ya: true });

    // Se toma el archivo de forma atómica: si dos pestañas piden lo mismo, lee una.
    const vencido = new Date(Date.now() - PLAZO_MS).toISOString();
    const { data: tomado } = await db
      .from("archivos")
      .update({
        estado_lectura: "procesando",
        procesando_desde: new Date().toISOString(),
        intentos: archivo.intentos + 1,
      })
      .eq("id", archivo.id)
      .or(`estado_lectura.in.(pendiente,fallido),and(estado_lectura.eq.procesando,procesando_desde.lt."${vencido}")`)
      .select("id");
    if (!tomado?.length) return responder(202, { ok: true, enCurso: true });

    const clave = Deno.env.get("GEMINI_API_KEY");
    if (!clave) throw new Error("Falta configurar la clave de lectura en el servidor. Avísale a administración.");

    const [{ data: tipos }, { data: conceptos }, descarga] = await Promise.all([
      db.from("tipos_comprobante").select("id, nombre").eq("activo", true).order("orden"),
      db.from("conceptos").select("id, nombre, categoria, subcategoria").eq("activo", true).order("nombre"),
      db.storage.from("comprobantes").download(archivo.ruta!),
    ]);
    if (descarga.error || !descarga.data) throw new Error("No se encontró la imagen guardada.");
    const cat: Catalogo = { tipos: tipos ?? [], conceptos: conceptos ?? [] };

    const crudo = await preguntar(
      clave,
      armarPrompt(cat, rendicion!.tipo),
      esquema(cat),
      archivo.tipo_mime,
      descarga.data,
    );
    const leidos = normalizar(crudo, cat);

    const { data: filas } = await db
      .from("comprobantes")
      .select(
        "id, pagina, proyecto_id, area_id, fecha, tipo_comprobante_id, serie, numero, ruc, proveedor, total, moneda, concepto_id, descripcion, solicitante, creado_por",
      )
      .eq("archivo_id", archivo.id)
      .order("pagina")
      .order("creado_en");
    const existentes = filas ?? [];
    const base = existentes[0];

    for (const [i, l] of leidos.entries()) {
      const confianza = { modelo: MODELO, campos: Object.keys(completar(vacia, l)) };
      const fila = existentes[i];
      if (fila) {
        const cambios = completar(fila as Fila, l);
        const { error } = await db
          .from("comprobantes")
          .update({ ...cambios, pagina: l.pagina, via: "ia", confianza })
          .eq("id", fila.id);
        if (error) throw new Error(`No se pudo guardar lo leído: ${error.message}`);
      } else {
        // Un comprobante más en la misma imagen o PDF: hereda lo que la persona
        // ya eligió para el primero (proyecto, área, solicitante).
        const { error } = await db.from("comprobantes").insert({
          rendicion_id: archivo.rendicion_id,
          archivo_id: archivo.id,
          pagina: l.pagina,
          proyecto_id: base?.proyecto_id ?? null,
          area_id: base?.area_id ?? null,
          solicitante: base?.solicitante ?? "",
          creado_por: base?.creado_por ?? quien.user.id,
          ...completar({ ...vacia, solicitante: base?.solicitante ?? "" }, l),
          via: "ia",
          confianza,
        });
        if (error) throw new Error(`No se pudo guardar lo leído: ${error.message}`);
      }
    }

    await db
      .from("archivos")
      .update({
        estado_lectura: "leido",
        leido_en: new Date().toISOString(),
        procesando_desde: null,
        error: leidos.length ? null : "No se reconoció ningún comprobante en la imagen.",
      })
      .eq("id", archivo.id);
    return responder(200, { ok: true, comprobantes: leidos.length });
  } catch (e) {
    const mensaje = (e as Error).message || "Error desconocido.";
    if (e instanceof Rechazo) return responder(e.status, { error: mensaje });
    console.error("leer", archivoId, e);
    if (archivoId) {
      await db
        .from("archivos")
        .update({ estado_lectura: "fallido", procesando_desde: null, error: mensaje.slice(0, 500) })
        .eq("id", archivoId)
        .eq("estado_lectura", "procesando");
    }
    return responder(502, { error: mensaje });
  }
});

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

/** Una llamada a Gemini con la imagen o el PDF adentro. Reintenta una vez si está saturado. */
async function preguntar(
  clave: string,
  prompt: string,
  schema: unknown,
  mime: string,
  archivo: Blob,
): Promise<unknown> {
  const cuerpo = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }, {
          inline_data: { mime_type: mime, data: encodeBase64(await archivo.arrayBuffer()) },
        }],
      },
    ],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`;

  for (let intento = 1;; intento++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": clave },
      body: cuerpo,
      signal: AbortSignal.timeout(90_000),
    });
    if (r.ok) return textoDeGemini(await r.json());
    if ((r.status === 429 || r.status >= 500) && intento < 2) {
      await new Promise((ok) => setTimeout(ok, 4000));
      continue;
    }
    const detalle = (await r.text()).slice(0, 300);
    if (r.status === 400 && /API key/i.test(detalle)) throw new Error("La clave de lectura del servidor no es válida.");
    if (r.status === 429) throw new Error("La lectura está saturada en este momento. Reintenta en un minuto.");
    throw new Error(`La IA respondió ${r.status}: ${detalle}`);
  }
}
