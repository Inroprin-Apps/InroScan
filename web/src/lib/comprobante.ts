/**
 * Un comprobante como fila de la rendición: cómo se escribe su número y qué le
 * falta para poder enviar.
 */

/**
 * «F001-6384» → serie F001, número 6384. Igual que partir_numero() del
 * procesador, salvo que acá los ceros a la izquierda se conservan: es lo que la
 * persona tecleó, y para encontrar repetidos ya normaliza la base (columna
 * comprobantes.clave). Las planillas vienen sin guion (010010): sin serie.
 */
export function partirNumero(texto: string): { serie: string; numero: string } {
  const t = texto.trim();
  const m = t.match(/^([A-Za-z0-9]{1,4})\s*[-–—]\s*([A-Za-z0-9]{1,15})$/);
  if (m) return { serie: m[1].toUpperCase(), numero: m[2].toUpperCase() };
  return { serie: "", numero: t.toUpperCase() };
}

export const numeroCompleto = (c: { serie: string; numero: string }) =>
  [c.serie, c.numero].filter(Boolean).join("-");

export type FilaParaRevisar = {
  fecha: string | null;
  tipo_comprobante_id: string | null;
  numero: string;
  total: number | string | null;
  proyecto_id: number | null;
  concepto_id: number | null;
  descartado: boolean;
};

/**
 * Lo que le falta a una fila para poder enviarse. La declaración jurada no
 * tiene número: es un papel que la persona escribe a mano.
 */
export function faltan(c: FilaParaRevisar): string[] {
  if (c.descartado) return [];
  const falta: string[] = [];
  if (!c.fecha) falta.push("fecha");
  if (!c.tipo_comprobante_id) falta.push("tipo");
  if (!c.numero.trim() && c.tipo_comprobante_id !== "DJ") falta.push("número");
  if (c.total == null || c.total === "") falta.push("total");
  if (c.proyecto_id == null) falta.push("proyecto");
  if (c.concepto_id == null) falta.push("concepto");
  return falta;
}
