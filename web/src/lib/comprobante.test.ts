import { describe, expect, it } from "vitest";
import { faltan, numeroCompleto, partirNumero } from "./comprobante";

describe("número de comprobante", () => {
  it("separa serie y número, conservando lo que se tecleó", () => {
    expect(partirNumero("f001-006384")).toEqual({ serie: "F001", numero: "006384" });
    expect(partirNumero(" 0001 - 003936 ")).toEqual({ serie: "0001", numero: "003936" });
  });

  it("una planilla sin guion no inventa serie", () => {
    expect(partirNumero("010010")).toEqual({ serie: "", numero: "010010" });
  });

  it("se vuelve a escribir igual", () => {
    expect(numeroCompleto({ serie: "F001", numero: "6384" })).toBe("F001-6384");
    expect(numeroCompleto({ serie: "", numero: "010010" })).toBe("010010");
  });
});

describe("qué le falta a una fila", () => {
  const completa = {
    fecha: "2026-10-20",
    tipo_comprobante_id: "BOLETA",
    numero: "123",
    total: 10,
    proyecto_id: 1,
    concepto_id: 1,
    descartado: false,
  };

  it("una fila completa no tiene faltantes", () => {
    expect(faltan(completa)).toEqual([]);
  });

  it("nombra lo que falta", () => {
    expect(faltan({ ...completa, fecha: null, total: null, concepto_id: null })).toEqual([
      "fecha",
      "total",
      "concepto",
    ]);
  });

  it("la declaración jurada no lleva número", () => {
    expect(faltan({ ...completa, tipo_comprobante_id: "DJ", numero: "" })).toEqual([]);
    expect(faltan({ ...completa, numero: "" })).toEqual(["número"]);
  });

  it("un total de cero es un dato, no un faltante", () => {
    expect(faltan({ ...completa, total: 0 })).toEqual([]);
  });

  it("lo descartado no bloquea el envío", () => {
    expect(faltan({ ...completa, fecha: null, descartado: true })).toEqual([]);
  });
});
