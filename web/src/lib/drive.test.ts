import { describe, expect, it } from "vitest";
import { idDeCarpeta } from "./drive";

describe("idDeCarpeta", () => {
  it("saca el id de los enlaces de Drive", () => {
    expect(
      idDeCarpeta(
        "https://drive.google.com/drive/folders/1da__wSl5n5qmkudb7fqY32TubN7E74ri",
      ),
    ).toBe("1da__wSl5n5qmkudb7fqY32TubN7E74ri");
    expect(
      idDeCarpeta(
        " https://drive.google.com/drive/u/1/folders/1da__wSl5n5qmkudb7fqY32TubN7E74ri?usp=sharing ",
      ),
    ).toBe("1da__wSl5n5qmkudb7fqY32TubN7E74ri");
    expect(
      idDeCarpeta(
        "https://drive.google.com/open?id=1da__wSl5n5qmkudb7fqY32TubN7E74ri",
      ),
    ).toBe("1da__wSl5n5qmkudb7fqY32TubN7E74ri");
    expect(idDeCarpeta("1da__wSl5n5qmkudb7fqY32TubN7E74ri")).toBe(
      "1da__wSl5n5qmkudb7fqY32TubN7E74ri",
    );
  });

  it("no acepta lo que no es una carpeta", () => {
    expect(idDeCarpeta("")).toBeNull();
    expect(idDeCarpeta("Rendiciones")).toBeNull();
    expect(
      idDeCarpeta("https://docs.google.com/spreadsheets/d/abc/edit"),
    ).toBeNull();
  });
});
