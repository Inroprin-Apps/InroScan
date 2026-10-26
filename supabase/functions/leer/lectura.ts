/**
 * La lectura de un comprobante, sin red ni base: el prompt, el esquema que se
 * le exige a la IA y la limpieza de lo que devuelve.
 *
 * Todo lo que sale de acá se trata como una propuesta: solo llena campos que
 * la persona dejó vacíos, y lo que no calza con las listas cerradas se
 * descarta en vez de guardarse a medias.
 */

export type TipoComprobante = { id: string; nombre: string };
export type Concepto = { id: number; nombre: string; categoria: string; subcategoria: string };
export type Catalogo = { tipos: TipoComprobante[]; conceptos: Concepto[] };

export type Leido = {
  pagina: number;
  fecha: string | null;
  tipo_comprobante_id: string | null;
  serie: string;
  numero: string;
  ruc: string;
  proveedor: string;
  total: number | null;
  moneda: "PEN" | "USD";
  concepto_id: number | null;
  descripcion: string;
  /** Quien firma una planilla de movilidad o una DJ. */
  persona: string;
};

/** Lo que guarda la base de una fila, en lo que a la lectura le importa. */
export type Fila = {
  fecha: string | null;
  tipo_comprobante_id: string | null;
  serie: string;
  numero: string;
  ruc: string;
  proveedor: string;
  total: number | string | null;
  moneda: string;
  concepto_id: number | null;
  descripcion: string;
  solicitante: string;
};

const sinTildes = (t: string) =>
  t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

export function armarPrompt(cat: Catalogo, tipoRendicion: "memo" | "caja"): string {
  const tipos = cat.tipos.map((t) => `  ${t.id}: ${t.nombre}`).join("\n");
  const conceptos = cat.conceptos.map((c) => `  ${c.nombre} (${c.categoria} / ${c.subcategoria})`).join("\n");
  const contexto = tipoRendicion === "memo"
    ? "Estos gastos son de un MEMO DE VIÁTICOS: una persona de viaje por trabajo. Su comida y hospedaje son VIATICOS; un taxi o pasaje suyo es MOVILIDAD DE PERSONAL."
    : "Estos gastos son de una CAJA CHICA de oficina u obra: compras menores, movilidades y servicios del día a día.";

  return `Eres asistente de contabilidad en Perú. Recibes la imagen o el PDF de uno o
varios comprobantes de pago y devuelves los datos de CADA UNO, según el esquema.

${contexto}

Reglas:

- Un objeto por comprobante. Es común escanear dos o tres boletas juntas en la
  misma hoja, y un PDF puede traer un comprobante por página: en "pagina" va la
  página del PDF donde está (1 si es una imagen).
- El criterio para separar es el NÚMERO DE COMPROBANTE. Los productos de una
  boleta NO son comprobantes: una boleta con cuatro platos es UN objeto cuyo
  total es el de la boleta. En la duda, devuelve menos objetos: uno de más
  inventa un gasto que no existe.
- Si no hay ningún comprobante de pago (una foto cualquiera, una hoja en
  blanco), devuelve una lista vacía.
- "tipo" es uno de estos códigos:
${tipos}
  Una boleta electrónica es BOLETA; una factura electrónica, FACTURA; un
  recibo por honorarios electrónico, RHE. Un ticket de máquina registradora
  sin serie de boleta es TICKET. Una DECLARACIÓN JURADA (DJ) es un formato
  donde la persona declara un gasto sin comprobante: no tiene RUC ni serie,
  suele llevar DNI y firma.
- "serie" y "numero" salen del código impreso: F001-6384, EB01-135,
  0001-003936. La serie es lo anterior al guion; el número, lo posterior sin
  los ceros de la izquierda. Una planilla de movilidad trae un número corrido
  sin guion: va entero en "numero" y la serie vacía.
- "fecha" en formato AAAA-MM-DD; si hay emisión y vencimiento, la de emisión.
- "ruc" son los once dígitos del EMISOR (empiezan en 10, 15, 17 o 20), no los
  del cliente.
- "proveedor" es la razón social del emisor. En una PLANILLA DE MOVILIDAD o una
  DJ no hay empresa emisora: pon el nombre de quien la firma en "proveedor" y
  también en "persona". En los demás casos "persona" va vacía.
- "total" es el importe final a pagar, como número (1234.5). "moneda" es USD
  solo si el comprobante lo dice.
- "concepto" es el único campo que DEDUCES en vez de leer: elige de esta lista,
  copiando el nombre tal cual, según qué se compró. Si no se distingue, déjalo
  vacío; es mejor que adivinar uno que suene verosímil.
${conceptos}
- "descripcion" dice en pocas palabras qué se compró y para qué, si se ve:
  «almuerzo para dos», «taxi al aeropuerto», «2 kg de pernos». Mayúsculas.

Si un dato no aparece o no se lee con certeza, déjalo vacío. NO lo inventes:
un campo vacío se corrige en dos segundos; uno inventado que parece correcto
se registra mal y nadie lo nota.`;
}

/** El esquema de respuesta de Gemini (subconjunto de OpenAPI). */
export function esquema(cat: Catalogo) {
  const texto = { type: "STRING" };
  return {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        pagina: { type: "INTEGER" },
        tipo: { type: "STRING", enum: [...cat.tipos.map((t) => t.id), "OTRO"] },
        serie: texto,
        numero: texto,
        fecha: texto,
        ruc: texto,
        proveedor: texto,
        total: { type: "NUMBER", nullable: true },
        moneda: { type: "STRING", enum: ["PEN", "USD"] },
        concepto: texto,
        descripcion: texto,
        persona: texto,
      },
      required: [
        "pagina",
        "tipo",
        "serie",
        "numero",
        "fecha",
        "ruc",
        "proveedor",
        "total",
        "moneda",
        "concepto",
        "descripcion",
        "persona",
      ],
    },
  };
}

const cadena = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

function fecha(v: unknown): string | null {
  const t = cadena(v);
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${t}T12:00:00Z`);
  // 2026-02-30 no es una fecha; y un comprobante de 1999 es un error de lectura.
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) return null;
  if (Number(m[1]) < 2020 || Number(m[1]) > 2100) return null;
  return t;
}

function importe(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const sinCeros = (t: string) => t.replace(/^0+(?=.)/, "");

/** De la respuesta cruda de la IA a filas que la base acepta sin rechazar. */
export function normalizar(crudo: unknown, cat: Catalogo): Leido[] {
  const lista = Array.isArray(crudo) ? crudo : [];
  const tipos = new Set(cat.tipos.map((t) => t.id));
  const conceptos = new Map(cat.conceptos.map((c) => [sinTildes(c.nombre), c.id]));

  return lista
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => {
      const tipo = tipos.has(cadena(x.tipo)) ? cadena(x.tipo) : null;
      const ruc = cadena(x.ruc).replace(/\D/g, "");
      let total = importe(x.total);
      // Una nota de crédito resta: en la base va en negativo.
      if (tipo === "NOTA_CREDITO" && total != null && total > 0) total = -total;
      const pagina = Number(x.pagina);
      const serie = cadena(x.serie).toUpperCase().replace(/\s+/g, "");
      const numero = cadena(x.numero).replace(/\s+/g, "");
      return {
        pagina: Number.isInteger(pagina) && pagina > 0 ? pagina : 1,
        fecha: fecha(x.fecha),
        tipo_comprobante_id: tipo,
        serie,
        // Sin serie (una planilla: 010010) el número se copia tal cual.
        numero: serie ? sinCeros(numero) : numero,
        ruc: /^(10|15|17|20)\d{9}$/.test(ruc) ? ruc : "",
        proveedor: cadena(x.proveedor).toUpperCase(),
        total,
        moneda: cadena(x.moneda) === "USD" ? "USD" : "PEN",
        concepto_id: conceptos.get(sinTildes(cadena(x.concepto))) ?? null,
        descripcion: cadena(x.descripcion).toUpperCase(),
        persona: cadena(x.persona).toUpperCase(),
      } satisfies Leido;
    })
    // Una entrada sin nada que la identifique no es un comprobante.
    .filter((l) => l.total != null || l.numero || l.ruc || l.proveedor);
}

const vacio = (v: unknown) => v == null || v === "";

/**
 * Lo que la lectura aporta a una fila: solo los campos que siguen vacíos.
 * Si la persona escribió algo mientras se leía, gana lo suyo.
 */
export function completar(fila: Fila, l: Leido): Partial<Fila> {
  const c: Partial<Fila> = {};
  if (vacio(fila.fecha) && l.fecha) c.fecha = l.fecha;
  if (vacio(fila.tipo_comprobante_id) && l.tipo_comprobante_id) c.tipo_comprobante_id = l.tipo_comprobante_id;
  // Serie y número van juntos: mezclar la serie de uno con el número de otro
  // daría un comprobante que no existe.
  if (vacio(fila.serie) && vacio(fila.numero) && (l.serie || l.numero)) {
    c.serie = l.serie;
    c.numero = l.numero;
  }
  if (vacio(fila.ruc) && l.ruc) c.ruc = l.ruc;
  if (vacio(fila.proveedor) && l.proveedor) c.proveedor = l.proveedor;
  if (vacio(fila.total) && l.total != null) {
    c.total = l.total;
    c.moneda = l.moneda;
  }
  if (vacio(fila.concepto_id) && l.concepto_id != null) c.concepto_id = l.concepto_id;
  if (vacio(fila.descripcion) && l.descripcion) c.descripcion = l.descripcion;
  if (vacio(fila.solicitante) && l.persona) c.solicitante = l.persona;
  return c;
}

/** Saca el JSON de la respuesta de Gemini, o explica por qué no hay. */
export function textoDeGemini(r: unknown): unknown {
  const cand = (r as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] })
    ?.candidates?.[0];
  const texto = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!texto) throw new Error(`La IA no devolvió nada (${cand?.finishReason ?? "sin respuesta"}).`);
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error("La IA devolvió algo que no es JSON.");
  }
}
