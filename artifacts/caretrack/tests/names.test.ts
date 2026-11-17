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

  it("addresses the administrator by title and last name", () => {
    expect(splitName("Sir Reyes, Ryan Michael Lao")).toEqual({ title: "Sir", last: "Reyes", first: "Ryan" });
    expect(shortName("Sir Reyes, Ryan Michael Lao")).toBe("Sir Reyes");
    expect(initials("Sir Reyes, Ryan Michael Lao")).toBe("RR");
  });

  it("still handles First Last names", () => {
    expect(shortName("Revie Balanag")).toBe("Revie");
    expect(initials("Jordan Morgan")).toBe("JM");
    expect(initials("Carla")).toBe("C");
    expect(shortName("")).toBe("");
  });
});
