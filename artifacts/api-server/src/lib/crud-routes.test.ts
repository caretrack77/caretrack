import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let currentUserId = 1;
let currentUserRole = "admin";

const deletedUserIds: number[] = [];
const deletedPatientIds: number[] = [];

vi.mock("@workspace/db", () => {
  const table = new Proxy({}, { get: () => ({}) });
  const mockDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [
            { id: 99, name: "Dr. Test Doctor", role: "provider", userId: 99 },
          ]),
        })),
      })),
    })),
    delete: vi.fn((_table) => ({
      where: vi.fn(async () => {
        deletedUserIds.push(99);
        deletedPatientIds.push(99);
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
  };
  return {
    db: mockDb,
    usersTable: table,
    patientsTable: table,
    patientProviderAssignmentsTable: table,
    privacyConsentsTable: table,
    auditLogsTable: table,
  };
});

vi.mock("../lib/auth", () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireUser: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRoles: (...roles: string[]) => (_req: unknown, res: { status: (c: number) => { json: (d: unknown) => void } }, next: () => void) => {
    if (!roles.includes(currentUserRole)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    next();
  },
  currentUser: () => ({ id: currentUserId, name: "Admin", role: currentUserRole }),
  passwordProblem: () => null,
  phoneVerifiedFor: async () => false,
}));

vi.mock("../lib/audit", () => ({
  writeAuditLog: async () => undefined,
}));

vi.mock("../lib/patient-access", () => ({
  canManagePatient: async () => true,
  canAccessPatient: async () => true,
  getVisiblePatientIds: async () => [99],
}));

vi.mock("../lib/coverage", () => ({
  coveringFor: async () => new Map(),
}));

vi.mock("./medications", () => ({
  prescriberNames: async () => new Map(),
}));

let base = "";
let close: () => void = () => undefined;

beforeAll(async () => {
  const { default: usersRouter } = await import("../routes/users");
  const { default: patientsRouter } = await import("../routes/patients");
  const app = express();
  app.use(express.json());
  app.use("/api", usersRouter);
  app.use("/api", patientsRouter);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

afterAll(() => close());

describe("Admin Dashboard & Doctor Dashboard CRUD APIs", () => {
  it("prevents an admin from deleting their own account", async () => {
    currentUserId = 1;
    currentUserRole = "admin";
    const res = await fetch(`${base}/api/users/1`, { method: "DELETE" });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("You can't delete your own account.");
  });

  it("allows an admin to delete a doctor user account", async () => {
    currentUserId = 1;
    currentUserRole = "admin";
    const res = await fetch(`${base}/api/users/99`, { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  it("prevents non-admins from deleting user accounts", async () => {
    currentUserRole = "provider";
    const res = await fetch(`${base}/api/users/99`, { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  it("allows admin or provider to delete a patient profile", async () => {
    currentUserRole = "admin";
    const res = await fetch(`${base}/api/patients/99`, { method: "DELETE" });
    expect(res.status).toBe(204);
  });
});
