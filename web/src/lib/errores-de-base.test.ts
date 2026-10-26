import { describe, expect, it } from "vitest";
import { mensajeDeBase } from "./errores-de-base";

describe("errores de la base en palabras de la persona", () => {
  it("memo repetido", () => {
    expect(
      mensajeDeBase({ code: "23505", message: 'duplicate key value violates unique constraint "rendiciones_memo_unico"' }),
    ).toMatch(/ya está registrado/);
  });

  it("dos reposiciones abiertas de la misma caja", () => {
    expect(
      mensajeDeBase({ code: "23505", message: 'duplicate key value violates unique constraint "una_reposicion_en_curso"' }),
    ).toMatch(/reposición en curso/);
  });

  it("RUC mal formado", () => {
    expect(
      mensajeDeBase({ code: "23514", message: 'new row for relation "comprobantes" violates check constraint "comprobantes_ruc_check"' }),
    ).toMatch(/11 dígitos/);
  });

  it("los motivos que escriben los triggers pasan tal cual", () => {
    expect(mensajeDeBase({ code: "P0001", message: "La rendición está enviada: ya no se edita." })).toBe(
      "La rendición está enviada: ya no se edita.",
    );
  });

  it("una edición que los permisos dejaron sin efecto", () => {
    expect(mensajeDeBase({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" })).toMatch(
      /cambió de estado/,
    );
  });

  it("sin conexión", () => {
    expect(mensajeDeBase({ message: "TypeError: Failed to fetch" })).toMatch(/Sin conexión/);
  });
});
