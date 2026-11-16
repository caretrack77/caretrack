// The capture time sent with changes saved on a device while offline.
import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { capturedAt, CAPTURED_AT_HEADER, OFFLINE_SYNC_WINDOW_MS } from "./offline-capture";

const req = (value?: string) => ({ header: (name: string) => (name === CAPTURED_AT_HEADER ? value : undefined) }) as unknown as Request;

describe("offline capture time", () => {
  it("is absent for normal online requests", () => {
    expect(capturedAt(req())).toBeNull();
  });

  it("keeps the time the change was made on the device", () => {
    const at = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(capturedAt(req(at.toISOString()))).toEqual({ at });
  });

  it("refuses invalid, future and too-old times instead of replacing them with now", () => {
    expect(capturedAt(req("not a date"))).toHaveProperty("error");
    expect(capturedAt(req(new Date(Date.now() + 60 * 60 * 1000).toISOString()))).toHaveProperty("error");
    expect(capturedAt(req(new Date(Date.now() - OFFLINE_SYNC_WINDOW_MS - 60_000).toISOString()))).toHaveProperty("error");
  });

  it("tolerates a phone clock a little ahead, capped at the server time", () => {
    const result = capturedAt(req(new Date(Date.now() + 60_000).toISOString()));
    expect(result && "at" in result && result.at.getTime() <= Date.now()).toBe(true);
  });
});
