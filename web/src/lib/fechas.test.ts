import { describe, expect, it } from "vitest";
import { cuando, fechaCorta } from "./fechas";

describe("fechas en palabras", () => {
  const ahora = new Date(2026, 9, 26, 12, 0);
  it("hoy, ayer o la fecha", () => {
    expect(cuando(new Date(2026, 9, 26, 9, 41).toISOString(), ahora)).toBe("Hoy 09:41");
    expect(cuando(new Date(2026, 9, 25, 17, 20).toISOString(), ahora)).toBe("Ayer 17:20");
    expect(cuando(new Date(2026, 9, 24, 8, 0).toISOString(), ahora)).toBe("24/10");
    expect(cuando(new Date(2025, 11, 30, 8, 0).toISOString(), ahora)).toBe("30/12/2025");
  });
  it("fecha corta sin husos", () => {
    expect(fechaCorta("2026-10-19")).toBe("19/10/2026");
    expect(fechaCorta(null)).toBe("—");
  });
});
