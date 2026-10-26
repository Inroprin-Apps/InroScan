import { describe, expect, it } from "vitest";
import { cuentas, soles } from "./cuentas";

const fila = (total: number | string | null, tipo: string | null, descartado = false) => ({
  total,
  tipo_comprobante_id: tipo,
  descartado,
});

describe("cuentas de la rendición", () => {
  // Memo 675: doce comprobantes por S/ 347.50, de los que dos son
  // declaraciones juradas por S/ 105.50. Recibió S/ 334.00. Los totales son
  // los de la plantilla real con la que se validó la versión anterior; cómo se
  // reparten entre los doce comprobantes es inventado.
  const memo675 = [
    ...[30, 25.5, 18, 40, 22, 15, 35.5, 20, 16, 20].map((t) => fila(t, "BOLETA")),
    fila(60, "DJ"),
    fila(45.5, "DJ"),
  ];

  it("reproduce el memo 675 al centavo", () => {
    const c = cuentas(memo675, 334, ["DJ"]);
    expect(c.gastado).toBe(347.5);
    expect(c.sustentado).toBe(242);
    expect(c.noSustenta).toBe(105.5);
    expect(c.comprobantes).toBe(12);
  });

  it("el saldo se mide contra lo gastado, no contra lo sustentado", () => {
    // Gastó S/ 13.50 más de lo recibido: la DJ también es plata que salió.
    expect(cuentas(memo675, 334, ["DJ"]).saldo).toBe(-13.5);
  });

  it("qué sustenta es un criterio de cada rendición, no una constante", () => {
    expect(cuentas(memo675, 334, []).sustentado).toBe(347.5);
  });

  it("lo descartado no suma", () => {
    const c = cuentas([fila(100, "FACTURA"), fila(50, "FACTURA", true)], 200, []);
    expect(c.gastado).toBe(100);
    expect(c.comprobantes).toBe(1);
  });

  it("una fila todavía sin tipo suma al gasto pero no sustenta", () => {
    const c = cuentas([fila(80, null), fila(20, "TICKET")], 100, []);
    expect(c.gastado).toBe(100);
    expect(c.sustentado).toBe(20);
  });

  it("los céntimos no se pierden por la coma flotante", () => {
    expect(cuentas([fila(0.1, "TICKET"), fila(0.2, "TICKET")], 1, []).gastado).toBe(0.3);
  });

  it("acepta los importes como texto, que es como puede llegar un numeric", () => {
    expect(cuentas([fila("12.50", "TICKET"), fila(null, "TICKET")], "100.00", []).gastado).toBe(12.5);
  });

  it("el consumo es sobre lo recibido; sin monto no hay porcentaje", () => {
    expect(cuentas([fila(50, "TICKET")], 200, []).consumo).toBe(25);
    expect(cuentas([fila(50, "TICKET")], 0, []).consumo).toBeNull();
  });

  it("escribe los soles como en Perú", () => {
    expect(soles(1234.5)).toBe("S/ 1,234.50");
    expect(soles(null)).toBe("S/ 0.00");
  });
});
