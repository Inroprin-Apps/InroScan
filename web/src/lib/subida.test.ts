import { describe, expect, it } from "vitest";
import { esPdf, medidaReducida, mensajeDeStorage } from "./subida";

describe("preparar la subida", () => {
  it("achica solo lo que pasa del lado máximo, sin deformar", () => {
    expect(medidaReducida(4000, 3000)).toEqual({ ancho: 2000, alto: 1500 });
    expect(medidaReducida(3000, 4032)).toEqual({ ancho: 1488, alto: 2000 });
    expect(medidaReducida(800, 600)).toEqual({ ancho: 800, alto: 600 });
  });

  it("reconoce un PDF por su tipo o por su nombre", () => {
    expect(esPdf({ type: "application/pdf", name: "x" })).toBe(true);
    expect(esPdf({ type: "", name: "FACTURA.PDF" })).toBe(true);
    expect(esPdf({ type: "image/jpeg", name: "foto.jpg" })).toBe(false);
  });

  it("explica los errores del almacenamiento", () => {
    expect(mensajeDeStorage({ message: "Failed to fetch" })).toMatch(/Sin conexión/);
    expect(mensajeDeStorage({ message: "The object exceeded the maximum allowed size" })).toMatch(/10 MB/);
    expect(mensajeDeStorage({ message: "new row violates row-level security policy" })).toMatch(/permiso/);
  });
});
