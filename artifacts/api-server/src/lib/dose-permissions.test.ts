// Only the patient may change a dose's status ("I've taken it", "I took it late", "Missed",
// "Skip", "Undo"). Doctors, caregivers and admins get 403 before any database work happens.
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let role = "provider";
const dbUsed = vi.fn();

vi.mock("@workspace/db", () => {
  const touch = () => { dbUsed(); throw new Error("database should not be reached"); };
  const table = new Proxy({}, { get: () => ({}) });
  return {
    db: new Proxy({}, { get: () => touch }),
    pool: { query: touch },
    auditLogsTable: table, doseLogsTable: table, medicationsTable: table,
  };
});
vi.mock("../lib/auth", () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireUser: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRoles: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  currentUser: () => ({ id: 7, name: "Test User", role }),
}));
vi.mock("../lib/patient-access", () => ({
  canAccessPatient: async () => { dbUsed(); return true; },
  canManagePatient: async () => true,
  getVisiblePatientIds: async () => [1],
}));
vi.mock("../lib/dose-scheduler", () => ({
  ensureDoseEventsForDate: async () => undefined, manilaDate: () => "2026-11-18",
  markOverdueDoses: async () => 0, MISSED_GRACE_PERIOD_MS: 7_200_000, sendDueReminders: async () => 0,
}));
vi.mock("../lib/notifications", () => ({ notifyProvidersForLowAdherence: async () => undefined }));
vi.mock("../lib/audit", () => ({ writeAuditLog: async () => undefined }));

let base = "";
let close: () => void = () => undefined;
beforeAll(async () => {
  const { default: router } = await import("../routes/doses");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => close());

const patch = (status: string) =>
  fetch(`${base}/api/doses/5/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });

describe("dose status permissions", () => {
  for (const blocked of ["provider", "caregiver", "admin"]) {
    for (const status of ["taken", "missed", "skipped", "scheduled"]) {
      it(`refuses a ${blocked} setting "${status}"`, async () => {
        role = blocked;
        dbUsed.mockClear();
        const res = await patch(status);
        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: string }).error).toMatch(/only the patient/i);
        expect(dbUsed).not.toHaveBeenCalled();
      });
    }
  }

  it("lets the patient through to the dose lookup", async () => {
    role = "patient";
    dbUsed.mockClear();
    const res = await patch("taken");
    // The mocked database refuses to run, so the request fails *after* the role check.
    expect(res.status).not.toBe(403);
    expect(dbUsed).toHaveBeenCalled();
  });
});
