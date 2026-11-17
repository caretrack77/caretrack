import { describe, expect, it } from "vitest";
import { initials, shortName, splitName } from "../src/names";

describe("display names", () => {
  it("reads Last, First Middle names", () => {
    expect(splitName("Andrade, Francisca Santiago")).toEqual({ title: "", last: "Andrade", first: "Francisca" });
    expect(initials("Andrade, Francisca Santiago")).toBe("FA");
    expect(shortName("Esteban, Aubrey Shaine Lazaro")).toBe("Aubrey");
  });

  it("addresses doctors by title and last name", () => {
    expect(shortName("Dr. Baltazar, Alessa Mikkah")).toBe("Dr. Baltazar");
    expect(initials("Dr. Idago, Gremory Dennis")).toBe("GI");
  });

  it("still handles First Last names", () => {
    expect(shortName("Revie Balanag")).toBe("Revie");
    expect(initials("Jordan Morgan")).toBe("JM");
    expect(initials("Carla")).toBe("C");
    expect(shortName("")).toBe("");
  });
});
