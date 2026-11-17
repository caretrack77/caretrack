// Team messages are only for administrators and doctors, and only across roles
// (admin <-> doctor). Patients and caregivers are refused before any data is read.
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let role = "provider";
const users: Record<number, { id: number; name: string; role: string; active: boolean }> = {
  1: { id: 1, name: "Admin", role: "admin", active: true },
  2: { id: 2, name: "Dr. Baltazar, Alessa Mikkah", role: "provider", active: true },
  3: { id: 3, name: "Dr. Idago, Gremory Dennis", role: "provider", active: true },
  4: { id: 4, name: "Andrade, Francisca Santiago", role: "patient", active: true },
};
const dbReads = vi.fn();
let lookupId = 0;

vi.mock("@workspace/db", () => {
  // A tiny stand-in for the query builder: only the colleague lookup returns data.
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "orderBy", "leftJoin", "groupBy", "insert", "values", "update", "set"]) chain[m] = () => chain;
  chain.limit = async () => { dbReads(); const u = users[lookupId]; return u ? [u] : []; };
  chain.returning = async () => [{ id: 99, senderId: 2, recipientId: 1, body: "x", readAt: null, createdAt: new Date() }];
  chain.then = (resolve: (v: unknown[]) => void) => { dbReads(); resolve([]); };
  const table = new Proxy({}, { get: () => ({}) });
  return { db: chain, notificationsTable: table, staffMessagesTable: table, usersTable: table };
});
vi.mock("drizzle-orm", () => ({ and: () => ({}), asc: () => ({}), desc: () => ({}), eq: (_c: unknown, v: unknown) => { if (typeof v === "number") lookupId = v; return {}; }, inArray: () => ({}), isNull: () => ({}), or: () => ({}), sql: () => ({}) }));
vi.mock("../lib/auth", () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireUser: (_req: unknown, _res: unknown, next: () => void) => next(),
  currentUser: () => ({ id: role === "admin" ? 1 : role === "provider" ? 2 : 4, name: "Me", role }),
}));
vi.mock("../lib/encryption", () => ({ encryptText: (s: string) => s, decryptText: (s: string) => s }));
vi.mock("../lib/audit", () => ({ writeAuditLog: async () => undefined }));
vi.mock("../lib/realtime", () => ({ publishUsers: () => undefined }));

let base = "";
let close: () => void = () => undefined;
beforeAll(async () => {
  const { default: router } = await import("../routes/staff-messages");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => close());

const call = (method: string, path: string, body?: unknown) =>
  fetch(`${base}/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

describe("team message permissions", () => {
  for (const blocked of ["patient", "caregiver"]) {
    it(`refuses a ${blocked} on every team-message route`, async () => {
      role = blocked;
      dbReads.mockClear();
      for (const [method, path] of [["GET", "/staff-messages/threads"], ["GET", "/staff-messages/1"], ["POST", "/staff-messages/1"], ["POST", "/staff-messages/1/read"]]) {
        const res = await call(method, path, method === "POST" ? { body: "hi" } : undefined);
        expect(res.status).toBe(403);
      }
      expect(dbReads).not.toHaveBeenCalled();
    });
  }

  it("lets a doctor message an administrator", async () => {
    role = "provider";
    const res = await call("POST", "/staff-messages/1", { body: "Clinic printer is offline" });
    expect(res.status).toBe(201);
  });

  it("doesn't let a doctor message another doctor or a patient", async () => {
    role = "provider";
    expect((await call("POST", "/staff-messages/3", { body: "hi" })).status).toBe(404);
    expect((await call("POST", "/staff-messages/4", { body: "hi" })).status).toBe(404);
  });

  it("lets an administrator message a doctor but not another administrator", async () => {
    role = "admin";
    expect((await call("POST", "/staff-messages/2", { body: "Please review the new schedule" })).status).toBe(201);
    expect((await call("POST", "/staff-messages/1", { body: "hi" })).status).toBe(404);
  });

  it("doesn't block patient routes mounted after it", async () => {
    // The role check is per route, so other paths pass straight through this router.
    role = "patient";
    const res = await call("GET", "/doses");
    expect(res.status).toBe(404); // not handled here (no 403 from this router)
  });
});
