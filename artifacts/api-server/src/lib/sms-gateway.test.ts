// SMS Gateway for Android (cloud relay) client: request format, honest status, and demo-number blocking.
// The relay is replaced by a stub; no real SMS is sent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendSmsDetailed, smsConfigured, undeliverablePhone, isDemoAccountEmail } from "./otp-delivery";

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];

function stubRelay(states: string[], postStatus = 202) {
  let poll = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ id: "msg-1", state: "Pending" }), { status: postStatus, headers: { "content-type": "application/json" } });
    }
    const state = states[Math.min(poll++, states.length - 1)];
    return new Response(JSON.stringify({ id: "msg-1", state }), { status: 200, headers: { "content-type": "application/json" } });
  }));
}

describe("SMS Gateway for Android (cloud relay)", () => {
  beforeEach(() => {
    calls = [];
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 500 });
    process.env.SMS_PROVIDER = "sms-gate";
    process.env.SMS_GATEWAY_USER = "relay-user";
    process.env.SMS_GATEWAY_PASSWORD = "relay-password";
    delete process.env.SMS_GATEWAY_URL;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is configured only with relay credentials", () => {
    expect(smsConfigured()).toBe(true);
    delete process.env.SMS_GATEWAY_PASSWORD;
    expect(smsConfigured()).toBe(false);
  });

  it("queues the text on the relay in the documented format, with basic auth and an expiry", async () => {
    stubRelay(["Sent"]);
    const result = await sendSmsDetailed("09171234567", "Your CareTrack login code is 123456.", 300);
    expect(result).toEqual({ ok: true, status: "sent" });
    const post = calls[0];
    expect(post.url).toBe("https://api.sms-gate.app/3rdparty/v1/messages");
    expect(post.init?.method).toBe("POST");
    expect((post.init?.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("relay-user:relay-password").toString("base64")}`);
    expect(JSON.parse(String(post.init?.body))).toEqual({
      textMessage: { text: "Your CareTrack login code is 123456." },
      phoneNumbers: ["+639171234567"],
      withDeliveryReport: true,
      ttl: 300,
    });
    expect(calls[1].url).toBe("https://api.sms-gate.app/3rdparty/v1/messages/msg-1");
  });

  it("reports a failure when the phone could not send it", async () => {
    stubRelay(["Processed", "Failed"]);
    expect(await sendSmsDetailed("09171234567", "x")).toEqual({ ok: false, status: "failed" });
  });

  it("does not claim 'sent' while the phone hasn't confirmed yet", async () => {
    stubRelay(["Pending"]);
    const pending = sendSmsDetailed("09171234567", "x");
    await vi.advanceTimersByTimeAsync(15_000); // past the 12-second confirmation wait
    expect(await pending).toEqual({ ok: true, status: "queued" });
  });

  it("reports a failure when the relay refuses the request (e.g. wrong credentials)", async () => {
    stubRelay(["Pending"], 401);
    expect(await sendSmsDetailed("09171234567", "x")).toEqual({ ok: false, status: "failed" });
  });

  it("never texts the demo accounts' made-up numbers", async () => {
    stubRelay(["Sent"]);
    expect(undeliverablePhone("09170000004")).toBe(true);
    expect(await sendSmsDetailed("09170000004", "x")).toEqual({ ok: false, status: "blocked" });
    expect(calls).toHaveLength(0);
  });

  it("recognises demo accounts only from the server's fixed list", () => {
    expect(isDemoAccountEmail("patient@caretrack.com")).toBe(true);
    expect(isDemoAccountEmail(" Admin@CareTrack.com ")).toBe(true);
    expect(isDemoAccountEmail("someone@gmail.com")).toBe(false);
    expect(isDemoAccountEmail("patient@caretrack.com.evil.example")).toBe(false);
  });
});
