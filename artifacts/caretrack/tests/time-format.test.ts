import { describe, expect, it } from "vitest";
import { clock12, dateTimeLabel, parseClock, parseClockList, timeLabel } from "../src/time-format";

// Newer ICU versions put a narrow no-break space before AM/PM; compare with a plain space.
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("12-hour time display", () => {
  it("shows stored schedule times in 12-hour form", () => {
    expect(clock12("08:00")).toBe("8:00 AM");
    expect(clock12("13:30")).toBe("1:30 PM");
    expect(clock12("20:00")).toBe("8:00 PM");
    expect(clock12("00:15")).toBe("12:15 AM");
    expect(clock12("12:00")).toBe("12:00 PM");
  });

  it("leaves anything that isn't a stored time unchanged", () => {
    expect(clock12("25:00")).toBe("25:00");
    expect(clock12("soon")).toBe("soon");
  });

  it("formats timestamps with AM/PM regardless of device locale", () => {
    const evening = new Date(2026, 10, 18, 20, 5);
    expect(plain(timeLabel(evening))).toBe("8:05 PM");
    expect(plain(timeLabel(evening.toISOString()))).toBe("8:05 PM");
    expect(plain(dateTimeLabel(evening))).toBe("Nov 18, 8:05 PM");
    expect(timeLabel("not a date")).toBe("not a date");
  });
});

describe("reading times typed by the doctor", () => {
  it("stores 12-hour input as HH:MM", () => {
    expect(parseClock("8:00 AM")).toBe("08:00");
    expect(parseClock("8 pm")).toBe("20:00");
    expect(parseClock("1:30PM")).toBe("13:30");
    expect(parseClock("12:00 am")).toBe("00:00");
    expect(parseClock("12:00 PM")).toBe("12:00");
    expect(parseClock("9:15 p.m.")).toBe("21:15");
  });

  it("still accepts the existing 24-hour values, so saved schedules don't change", () => {
    expect(parseClock("08:00")).toBe("08:00");
    expect(parseClock("20:00")).toBe("20:00");
    expect(parseClock(clock12("20:00"))).toBe("20:00");
  });

  it("rejects ambiguous or impossible times", () => {
    expect(parseClock("8")).toBeNull();
    expect(parseClock("13:00 PM")).toBeNull();
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("8:75 AM")).toBeNull();
    expect(parseClock("noon")).toBeNull();
  });

  it("parses a comma-separated list, de-duplicated and in order", () => {
    expect(parseClockList("8:00 PM, 8:00 AM, 20:00")).toEqual({ times: ["08:00", "20:00"], invalid: [] });
    expect(parseClockList("8:00 AM, later")).toEqual({ times: ["08:00"], invalid: ["later"] });
  });
});
