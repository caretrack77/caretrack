// Android app authentication over real HTTP: CORS for the app origin, the session token handed
// over in a header (never a cookie) and accepted back as a bearer token, while browsers keep
// HTTP-only cookies. The database is replaced by a small in-memory fake.
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/caretrack_test";
  process.env.SESSION_SECRET = "test-secret-for-mobile-auth";
  process.env.OTP_ENABLED = "false";
  process.env.CORS_ORIGIN = "https://caretrack.example.com";
});

// These tests sign in many times from one address; the real sign-in rate limits are not under test here.
vi.mock("./rate-limit", () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { loginRateLimit: pass, otpRequestRateLimit: pass, otpVerifyRateLimit: pass, passwordRateLimit: pass, chatbotRateLimit: pass };
});

const store = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  sessions: new Map<string, number>(), // token hash -> user id
  consentVersion: "",
}));

/** Finds a string anywhere inside a Drizzle condition object (e.g. the token hash in `eq(...)`). */
function findString(value: unknown, wanted: (s: string) => boolean, seen = new Set<unknown>()): string | undefined {
  if (typeof value === "string") return wanted(value) ? value : undefined;
  if (!value || typeof value !== "object" || seen.has(value)) return undefined;
  seen.add(value);
  for (const key of Object.keys(value)) {
    const found = findString((value as Record<string, unknown>)[key], wanted, seen);
    if (found) return found;
  }
  return undefined;
}

vi.mock("@workspace/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@workspace/db")>();
  // A query builder stand-in: every method returns itself; awaiting it runs `resolve`.
  const chain = (resolve: (conditions: unknown[]) => unknown) => {
    const conditions: unknown[] = [];
    const proxy: unknown = new Proxy(() => undefined, {
      get(_target, prop) {
        if (prop === "then") return (ok: (v: unknown) => void, fail: (e: unknown) => void) => Promise.resolve().then(() => resolve(conditions)).then(ok, fail);
        return (...args: unknown[]) => { conditions.push(...args); return proxy; };
      },
    });
    return proxy;
  };
  const isHash = (s: string) => store.sessions.has(s);
  const db = {
    select: (fields?: Record<string, unknown>) => chain((conditions) => {
      if (fields && "tokenHash" in fields) {
        const hash = findString(conditions, isHash);
        return hash && store.user ? [{ ...store.user, tokenHash: hash }] : [];
      }
      if (fields && "version" in fields) return store.consentVersion ? [{ version: store.consentVersion }] : [];
      return store.user ? [store.user] : [];
    }),
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        if (table === real.sessionsTable) store.sessions.set(String(row.tokenHash), Number(row.userId));
        return chain(() => []);
      },
    }),
    delete: (table: unknown) => chain((conditions) => {
      if (table !== real.sessionsTable) return [];
      const hash = findString(conditions, isHash);
      if (!hash) return [];
      const userId = store.sessions.get(hash);
      store.sessions.delete(hash);
      return [{ userId }];
    }),
    update: () => chain(() => []),
  };
  return { ...real, db };
});

const { default: app } = await import("../app");
const { PRIVACY_NOTICE_VERSION } = await import("./security-config");

const APP = { origin: "https://localhost", "x-caretrack-client": "android-app", "user-agent": "Mozilla/5.0 (Linux; Android 14) Mobile" };
const hash = (token: string) => createHash("sha256").update(token).update(process.env.SESSION_SECRET!).digest("hex");
let server: Server;
let base = "";

beforeAll(async () => {
  store.user = {
    id: 7, name: "Alex Morgan", email: "patient@caretrack.demo", role: "patient", active: true,
    mustChangePassword: false, phone: null, passwordHash: await bcrypt.hash("caretrack-demo", 4),
  };
  store.consentVersion = PRIVACY_NOTICE_VERSION;
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const login = (headers: Record<string, string>) =>
  fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ email: "patient@caretrack.demo", password: "caretrack-demo" }),
  });

describe("CORS for the Android app", () => {
  it("allows the app origin without cookies and exposes the session header", async () => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "OPTIONS",
      headers: { origin: "https://localhost", "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-caretrack-client,authorization" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    const get = await fetch(`${base}/api/healthz`, { headers: { origin: "https://localhost" } });
    expect(get.headers.get("access-control-expose-headers")).toContain("x-caretrack-session");
  });

  it("keeps the configured web origin (with cookies) and refuses unknown origins", async () => {
    const web = await fetch(`${base}/api/healthz`, { headers: { origin: "https://caretrack.example.com" } });
    expect(web.headers.get("access-control-allow-origin")).toBe("https://caretrack.example.com");
    expect(web.headers.get("access-control-allow-credentials")).toBe("true");
    const other = await fetch(`${base}/api/healthz`, { headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("Android app sign-in", () => {
  it("gives the app its token in a header (no cookie) and accepts it as a bearer token", async () => {
    const res = await login(APP);
    expect(res.status).toBe(200);
    const token = res.headers.get("x-caretrack-session");
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(store.sessions.has(hash(token!))).toBe(true); // only the hash is stored

    const me = await fetch(`${base}/api/auth/me`, { headers: { ...APP, authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { role: string }).role).toBe("patient");

    const wrong = await fetch(`${base}/api/auth/me`, { headers: { ...APP, authorization: `Bearer ${"x".repeat(43)}` } });
    expect(wrong.status).toBe(401);

    // Logout ends the session on the server; the token stops working.
    const out = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { ...APP, authorization: `Bearer ${token}` } });
    expect(out.status).toBe(204);
    const after = await fetch(`${base}/api/auth/me`, { headers: { ...APP, authorization: `Bearer ${token}` } });
    expect(after.status).toBe(401);
  });

  it("leaves the browser flow unchanged: HTTP-only cookie, no token header", async () => {
    store.user!.role = "provider";
    const res = await login({ "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/140" });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-caretrack-session")).toBeNull();
    const cookie = res.headers.get("set-cookie") || "";
    expect(cookie).toMatch(/caretrack_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: cookie.split(";")[0] } });
    expect(me.status).toBe(200);
    store.user!.role = "patient";
  });

  it("still keeps patient accounts off desktop browsers", async () => {
    const res = await login({ "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/140" });
    expect(res.status).toBe(403);
  });
});

// Patients and caregivers: the Android app only. Doctors and admins: a desktop/laptop browser only.
describe("which device each role may use", () => {
  const DESKTOP = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140" };
  const PHONE_BROWSER = { "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/140 Mobile Safari/537.36" };
  const as = async (role: string, headers: Record<string, string>) => {
    store.user!.role = role;
    const res = await login(headers);
    store.user!.role = "patient";
    return { status: res.status, code: res.status === 403 ? ((await res.json()) as { code: string }).code : null };
  };

  for (const role of ["patient", "caregiver"]) {
    it(`${role}: allowed in the app, refused on desktop and phone browsers`, async () => {
      expect((await as(role, APP)).status).toBe(200);
      expect(await as(role, DESKTOP)).toEqual({ status: 403, code: "MOBILE_APP_REQUIRED" });
      expect(await as(role, PHONE_BROWSER)).toEqual({ status: 403, code: "MOBILE_APP_REQUIRED" });
    });
    it(`${role}: a browser can't pretend to be the app`, async () => {
      // The website adding the app's header still sends its own Origin, or marks the request same-origin.
      expect(await as(role, { ...PHONE_BROWSER, "x-caretrack-client": "android-app", origin: "https://caretrack.example.com" })).toEqual({ status: 403, code: "MOBILE_APP_REQUIRED" });
      expect(await as(role, { ...DESKTOP, "x-caretrack-client": "android-app", "sec-fetch-site": "same-origin" })).toEqual({ status: 403, code: "MOBILE_APP_REQUIRED" });
    });
  }

  for (const role of ["provider", "admin"]) {
    it(`${role}: allowed on a desktop browser, refused in the app and on phones`, async () => {
      expect((await as(role, DESKTOP)).status).toBe(200);
      expect(await as(role, APP)).toEqual({ status: 403, code: "DESKTOP_REQUIRED" });
      expect(await as(role, PHONE_BROWSER)).toEqual({ status: 403, code: "DESKTOP_REQUIRED" });
      expect(await as(role, { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148" })).toEqual({ status: 403, code: "DESKTOP_REQUIRED" });
    });
  }

  it("a session can't be moved to a device the role may not use", async () => {
    store.user!.role = "provider";
    const res = await login(DESKTOP);
    const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
    expect((await fetch(`${base}/api/auth/me`, { headers: { ...DESKTOP, cookie } })).status).toBe(200);
    const moved = await fetch(`${base}/api/patients`, { headers: { ...PHONE_BROWSER, cookie } });
    expect(moved.status).toBe(403);
    store.user!.role = "patient";
  });
});
