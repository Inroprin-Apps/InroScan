/**
 * Lo poco de Google que hace falta: el token, la unidad compartida, carpetas,
 * subir, convertir a hoja, exportar a PDF y compartir. Todo con
 * `supportsAllDrives`, porque los archivos viven en una unidad compartida.
 *
 * `pedir` se inyecta para poder probar sin red.
 */

export type Pedir = typeof fetch;

const API = "https://www.googleapis.com/drive/v3";
const SUBIDA = "https://www.googleapis.com/upload/drive/v3/files";
const CARPETA = "application/vnd.google-apps.folder";
const HOJA = "application/vnd.google-apps.spreadsheet";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export class ErrorDeGoogle extends Error {
  constructor(public status: number, mensaje: string) {
    super(mensaje);
  }
}

async function comprobar(r: Response, que: string): Promise<Response> {
  if (r.ok) return r;
  const detalle = (await r.text()).slice(0, 300);
  if (r.status === 401 || /invalid_grant/.test(detalle)) {
    throw new ErrorDeGoogle(
      r.status,
      "La conexión con Drive venció o se revocó: vuelve a conectarla en Administración › Drive.",
    );
  }
  if (r.status === 403 && /accessNotConfigured|SERVICE_DISABLED/.test(detalle)) {
    throw new ErrorDeGoogle(r.status, "La API de Google Drive no está activada en el proyecto de Google Cloud.");
  }
  throw new ErrorDeGoogle(r.status, `Drive no pudo ${que} (${r.status}): ${detalle}`);
}

/** Canjea el código de la pantalla de Google por tokens (con el de larga duración). */
export async function canjearCodigo(
  pedir: Pedir,
  datos: { code: string; redirect_uri: string; client_id: string; client_secret: string },
): Promise<{ refresh_token?: string; access_token: string }> {
  const r = await pedir("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...datos, grant_type: "authorization_code" }),
  });
  return (await comprobar(r, "conectar la cuenta")).json();
}

export async function tokenDeAcceso(
  pedir: Pedir,
  datos: { refresh_token: string; client_id: string; client_secret: string },
): Promise<string> {
  const r = await pedir("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...datos, grant_type: "refresh_token" }),
  });
  return (await (await comprobar(r, "renovar el acceso")).json()).access_token;
}

export async function correoDe(pedir: Pedir, token: string): Promise<string> {
  const r = await pedir("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await (await comprobar(r, "leer la cuenta")).json()).email;
}

/** Comillas y barras escapadas para las consultas `q` de Drive. */
const literal = (t: string) => `'${t.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export class Drive {
  constructor(private pedir: Pedir, private token: string) {}

  private async llamar(url: string, que: string, init: RequestInit = {}): Promise<Response> {
    const r = await this.pedir(url, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) },
    });
    return comprobar(r, que);
  }

  /** La unidad compartida por su nombre, entre las que ve la cuenta. */
  async unidadPorNombre(nombre: string): Promise<{ id: string; name: string } | null> {
    const q = encodeURIComponent(`name = ${literal(nombre)}`);
    const r = await this.llamar(`${API}/drives?q=${q}&pageSize=10`, "buscar la unidad compartida");
    return (await r.json()).drives?.[0] ?? null;
  }

  /** Busca una carpeta por nombre dentro de otra; si no está, la crea. */
  async carpeta(nombre: string, padre: string, unidad: string): Promise<string> {
    const q = encodeURIComponent(
      `name = ${literal(nombre)} and ${literal(padre)} in parents and mimeType = '${CARPETA}' and trashed = false`,
    );
    const r = await this.llamar(
      `${API}/files?q=${q}&corpora=drive&driveId=${unidad}&includeItemsFromAllDrives=true&supportsAllDrives=true&fields=files(id)`,
      "buscar una carpeta",
    );
    const hallada = (await r.json()).files?.[0]?.id;
    if (hallada) return hallada;
    const c = await this.llamar(`${API}/files?supportsAllDrives=true&fields=id`, "crear una carpeta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nombre, mimeType: CARPETA, parents: [padre] }),
    });
    return (await c.json()).id;
  }

  /** Sube un archivo. `comoHoja` convierte un .xlsx en Google Sheets al subirlo. */
  async subir(
    nombre: string,
    padre: string,
    contenido: Blob,
    mime: string,
    comoHoja = false,
  ): Promise<{ id: string; md5Checksum?: string; size?: string; webViewLink: string }> {
    const metadatos = { name: nombre, parents: [padre], ...(comoHoja ? { mimeType: HOJA } : {}) };
    // Drive pide «multipart/related» (no el multipart de un formulario): los
    // metadatos y el contenido, cada uno con su tipo.
    const borde = `inroscan-${crypto.randomUUID()}`;
    const cuerpo = new Blob([
      `--${borde}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadatos)}\r\n`,
      `--${borde}\r\nContent-Type: ${comoHoja ? XLSX : mime}\r\n\r\n`,
      contenido,
      `\r\n--${borde}--`,
    ]);
    const r = await this.llamar(
      `${SUBIDA}?uploadType=multipart&supportsAllDrives=true&fields=id,md5Checksum,size,webViewLink`,
      `subir «${nombre}»`,
      { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${borde}` }, body: cuerpo },
    );
    return r.json();
  }

  /** Una hoja de Google exportada a PDF. */
  async pdf(id: string): Promise<Blob> {
    const r = await this.llamar(`${API}/files/${id}/export?mimeType=application/pdf`, "exportar el PDF");
    return r.blob();
  }

  async datos(id: string): Promise<{ md5Checksum?: string; size?: string; trashed?: boolean }> {
    const r = await this.llamar(
      `${API}/files/${id}?supportsAllDrives=true&fields=md5Checksum,size,trashed`,
      "verificar una copia",
    );
    return r.json();
  }

  /** A la papelera de la unidad (se puede recuperar), no borrado definitivo. */
  async papelera(id: string): Promise<void> {
    await this.llamar(`${API}/files/${id}?supportsAllDrives=true`, "mandar a la papelera", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
  }

  /** Deja ver la carpeta a quien rinde, sin mandarle correo. */
  async compartir(id: string, correo: string): Promise<void> {
    await this.llamar(
      `${API}/files/${id}/permissions?supportsAllDrives=true&sendNotificationEmail=false`,
      "compartir la carpeta",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "user", emailAddress: correo }),
      },
    );
  }
}
