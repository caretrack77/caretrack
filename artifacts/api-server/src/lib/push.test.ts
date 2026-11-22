import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: dbMock,
  pushTokensTable: { userId: "user_id", token: "token" },
}));

import { sendMessagePush } from "./push";

describe("Firebase message push", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends a generic notification and an authenticated in-app destination", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const originalAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: "caretrack-test",
      client_email: "caretrack-push@example.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    });

    const query = {
      from: vi.fn(),
      where: vi.fn(),
    };
    query.from.mockReturnValue(query);
    query.where.mockResolvedValue([{ userId: 7, token: "device-token" }]);
    dbMock.select.mockReturnValue(query);

    const requests: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === "https://oauth2.googleapis.com/token") {
        const assertion = new URLSearchParams(String(init?.body)).get("assertion");
        expect(assertion).toBeTruthy();
        const [header, claims, signature] = assertion!.split(".");
        const unsigned = `${header}.${claims}`;
        expect(verify("RSA-SHA256", Buffer.from(unsigned), publicKey, Buffer.from(signature, "base64url"))).toBe(true);
        expect(JSON.parse(Buffer.from(claims, "base64url").toString()).scope).toBe(
          "https://www.googleapis.com/auth/firebase.messaging",
        );
        return new Response(JSON.stringify({ access_token: "test-access-token", expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ name: "projects/caretrack-test/messages/1" }), { status: 200 });
    }));

    try {
      await sendMessagePush([7, 7], {
        notificationId: 23,
        url: "/messages?patient=4",
        kind: "message",
      });
      await sendMessagePush([7], {
        notificationId: 24,
        url: "/coverage",
        kind: "coverage",
        title: "Patient transfer request",
        body: "A doctor requested to transfer a patient to your care. Open CareTrack to review.",
      });
    } finally {
      if (originalAccount === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = originalAccount;
    }

    expect(requests).toHaveLength(3);
    expect(requests[1].url).toBe("https://fcm.googleapis.com/v1/projects/caretrack-test/messages:send");
    const fcmRequest = JSON.parse(String(requests[1].init?.body));
    expect(fcmRequest.message.notification).toEqual({
      title: "New CareTrack message",
      body: "Open CareTrack to read your message.",
    });
    expect(fcmRequest.message.data).toEqual({
      url: "/messages?patient=4",
      kind: "message",
      notificationId: "23",
    });
    expect(JSON.stringify(fcmRequest)).not.toContain("patient details");
    expect(requests[1].init?.headers).toMatchObject({ authorization: "Bearer test-access-token" });

    expect(requests).toHaveLength(3);
    const coverageRequest = JSON.parse(String(requests[2].init?.body));
    expect(coverageRequest.message.notification).toEqual({
      title: "Patient transfer request",
      body: "A doctor requested to transfer a patient to your care. Open CareTrack to review.",
    });
    expect(coverageRequest.message.data).toEqual({
      url: "/coverage",
      kind: "coverage",
      notificationId: "24",
    });
  });
});
