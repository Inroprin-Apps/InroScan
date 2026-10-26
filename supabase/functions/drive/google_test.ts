import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { canjearCodigo, Drive, ErrorDeGoogle, type Pedir } from "./google.ts";

type Llamada = { url: string; init: RequestInit };

/** Un Google de mentira: responde según la URL y anota cada pedido. */
function falso(respuestas: [RegExp, unknown, number?][]): { pedir: Pedir; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const pedir = ((url: string, init: RequestInit = {}) => {
    llamadas.push({ url, init });
    const r = respuestas.find(([re]) => re.test(url));
    const [, cuerpo, status = 200] = r ?? [, { error: "sin respuesta" }, 404];
    return Promise.resolve(new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), { status }));
  }) as Pedir;
  return { pedir, llamadas };
}

Deno.test("la carpeta se busca dentro de la unidad y se crea si no está", async () => {
  const { pedir, llamadas } = falso([
    [/\/files\?q=/, { files: [] }],
    [/\/files\?supportsAllDrives=true&fields=id$/, { id: "nueva" }],
  ]);
  const id = await new Drive(pedir, "tok").carpeta("Memo 675-2026", "padre", "unidad");
  assertEquals(id, "nueva");
  const q = decodeURIComponent(new URL(llamadas[0].url).searchParams.get("q")!);
  assertEquals(q.includes("name = 'Memo 675-2026' and 'padre' in parents"), true);
  assertEquals(new URL(llamadas[0].url).searchParams.get("driveId"), "unidad");
  assertEquals(JSON.parse(String(llamadas[1].init.body)), {
    name: "Memo 675-2026",
    mimeType: "application/vnd.google-apps.folder",
    parents: ["padre"],
  });
  assertEquals((llamadas[1].init.headers as Record<string, string>).Authorization, "Bearer tok");
});

Deno.test("si la carpeta ya existe no se duplica", async () => {
  const { pedir, llamadas } = falso([[/\/files\?q=/, { files: [{ id: "vieja" }] }]]);
  assertEquals(await new Drive(pedir, "t").carpeta("Cajas", "u", "u"), "vieja");
  assertEquals(llamadas.length, 1);
});

Deno.test("un nombre con comilla no rompe la consulta", async () => {
  const { pedir, llamadas } = falso([[/\/files\?q=/, { files: [{ id: "x" }] }]]);
  await new Drive(pedir, "t").carpeta("O'Higgins", "p", "u");
  const q = decodeURIComponent(new URL(llamadas[0].url).searchParams.get("q")!);
  assertEquals(q.startsWith("name = 'O\\'Higgins'"), true);
});

Deno.test("subir como hoja pide la conversión a Google Sheets", async () => {
  const { pedir, llamadas } = falso([[/upload\/drive\/v3\/files/, { id: "h1", webViewLink: "https://docs/h1" }]]);
  const r = await new Drive(pedir, "t").subir("Memo · v1", "carpeta", new Blob(["x"]), "x", true);
  assertEquals(r.id, "h1");
  const tipo = (llamadas[0].init.headers as Record<string, string>)["Content-Type"];
  const borde = tipo.match(/^multipart\/related; boundary=(.+)$/)![1];
  const partes = (await (llamadas[0].init.body as Blob).text()).split(`--${borde}`);
  assertEquals(partes.length, 4); // antes, metadatos, archivo, cierre
  const [cabMeta, meta] = partes[1].split("\r\n\r\n");
  assertEquals(cabMeta.includes("application/json"), true);
  assertEquals(JSON.parse(meta), {
    name: "Memo · v1",
    parents: ["carpeta"],
    mimeType: "application/vnd.google-apps.spreadsheet",
  });
  const [cabArchivo, contenido] = partes[2].split("\r\n\r\n");
  assertEquals(cabArchivo.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), true);
  assertEquals(contenido, "x\r\n");
  assertEquals(llamadas[0].url.includes("supportsAllDrives=true"), true);
});

Deno.test("errores de Google en palabras", async () => {
  const vencido = falso([[/token/, { error: "invalid_grant" }, 400]]);
  await assertRejects(
    () => canjearCodigo(vencido.pedir, { code: "c", redirect_uri: "r", client_id: "i", client_secret: "s" }),
    ErrorDeGoogle,
    "vuelve a conectarla",
  );
  const apagada = falso([[/drives/, { error: { message: "accessNotConfigured" } }, 403]]);
  await assertRejects(() => new Drive(apagada.pedir, "t").unidadPorNombre("x"), ErrorDeGoogle, "no está activada");
});
