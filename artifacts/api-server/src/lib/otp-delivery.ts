import nodemailer from "nodemailer";
import { logger } from "./logger";

/**
 * Sends one-time login codes by email (Gmail SMTP) or SMS.
 *
 * SMS providers (set SMS_PROVIDER in .env):
 *  - "sms-gate"         RECOMMENDED, no subscription: the open-source "SMS Gateway for Android"
 *                       app (sms-gate.app) on a phone with a Philippine SIM, in Cloud mode. The
 *                       phone keeps an outbound connection to the free relay api.sms-gate.app;
 *                       this server asks the relay to send, and the phone texts from its own SIM
 *                       (normal SIM texting charges apply). Works from Render: the phone never
 *                       needs a public address. See docs/SMS_OTP.md.
 *  - "android-gateway"  The same app in Local mode (phone on the same Wi-Fi as this server).
 *  - "semaphore"        Semaphore (paid Philippine SMS API)
 *  - "twilio"           Twilio (paid, international)
 *
 * Every function returns false instead of throwing when delivery is not configured
 * or fails, so the caller can fall back to showing the code on screen.
 */

const TIMEOUT_MS = 10_000;
const SMS_GATE_CLOUD_URL = "https://api.sms-gate.app/3rdparty/v1";
/** How long to wait for the gateway phone to confirm it sent a code before answering the user. */
const SMS_GATE_CONFIRM_MS = 12_000;

export function emailConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export function smsConfigured(): boolean {
  switch (process.env.SMS_PROVIDER) {
    case "semaphore":
      return Boolean(process.env.SEMAPHORE_API_KEY);
    case "twilio":
      return Boolean(
        process.env.TWILIO_ACCOUNT_SID &&
          process.env.TWILIO_AUTH_TOKEN &&
          process.env.TWILIO_FROM_NUMBER,
      );
    case "sms-gate":
      return Boolean(process.env.SMS_GATEWAY_USER && process.env.SMS_GATEWAY_PASSWORD);
    case "android-gateway":
      return Boolean(process.env.SMS_GATEWAY_URL);
    default:
      return false;
  }
}

/**
 * The made-up numbers of the seeded demo accounts (scripts/seed.mjs). In the Philippines they
 * could belong to real people, so nothing is ever texted to them.
 */
const DEMO_PHONE_NUMBERS = new Set(["+639170000001", "+639170000002", "+639170000003", "+639170000004", "+639170000005"]);
export function undeliverablePhone(phone: string): boolean {
  return DEMO_PHONE_NUMBERS.has(toInternational(phone));
}

/** What happened to a text, as far as the server can tell. */
export type SmsResult = {
  ok: boolean;
  /** sent/delivered: the phone confirmed; queued: the gateway accepted it but the phone hasn't confirmed yet. */
  status: "sent" | "delivered" | "queued" | "failed" | "not-configured" | "blocked";
};

/** Converts Philippine local numbers (09XXXXXXXXX) to international format (+639XXXXXXXXX). */
export function toInternational(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("09") && digits.length === 11) return `+63${digits.slice(1)}`;
  if (digits.startsWith("63")) return `+${digits}`;
  return digits;
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

/**
 * The seeded demo accounts (scripts/seed.mjs). caretrack.com is a real domain we don't own, so
 * their login codes must never be emailed; the sign-in screen shows the code instead.
 */
const DEMO_ACCOUNT_EMAILS = new Set([
  "admin@caretrack.com",
  "doctor@caretrack.com",
  "doctor2@caretrack.com",
  "patient@caretrack.com",
  "caregiver@caretrack.com",
]);

export function isDemoAccountEmail(address: string): boolean {
  return DEMO_ACCOUNT_EMAILS.has(address.trim().toLowerCase());
}

/** Demo accounts and reserved domains (e.g. name@caretrack.test) can't receive mail. */
export function undeliverableEmail(address: string): boolean {
  if (DEMO_ACCOUNT_EMAILS.has(address.trim().toLowerCase())) return true;
  return /\.(demo|test|example|invalid|localhost|local)$/i.test(address.split("@")[1] ?? "");
}

export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  // Returning false makes the login screen show the code instead (offline mode).
  if (!emailConfigured() || undeliverableEmail(to)) return false;
  try {
    transporter ??= nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
    });
    await transporter.sendMail({
      from: `"CareTrack" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      text,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1c424f">${text
        .split("\n")
        .map((line) => `<p>${line.replace(/</g, "&lt;")}</p>`)
        .join("")}</div>`,
    });
    return true;
  } catch (err) {
    logger.warn({ err }, "Email delivery failed");
    return false;
  }
}

async function post(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

function smsGateAuthHeader(): string {
  return `Basic ${Buffer.from(`${process.env.SMS_GATEWAY_USER}:${process.env.SMS_GATEWAY_PASSWORD ?? ""}`).toString("base64")}`;
}

/**
 * SMS Gateway for Android, Cloud mode: queue the text on the relay, then briefly follow its
 * state so the user is told the truth (sent, still on its way, or failed).
 * `ttlSeconds` drops the text if the phone can't send it in time (an expired code is useless).
 */
async function sendViaSmsGate(phone: string, text: string, ttlSeconds?: number): Promise<SmsResult> {
  const base = (process.env.SMS_GATEWAY_URL || SMS_GATE_CLOUD_URL).replace(/\/+$/, "");
  const headers = { "content-type": "application/json", authorization: smsGateAuthHeader() };
  const response = await post(`${base}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      textMessage: { text },
      phoneNumbers: [toInternational(phone)],
      withDeliveryReport: true,
      ...(ttlSeconds ? { ttl: ttlSeconds } : {}),
    }),
  });
  if (!response.ok) {
    logger.warn({ status: response.status, body: (await response.text()).slice(0, 300) }, "SMS gateway refused the message");
    return { ok: false, status: "failed" };
  }
  const queued = (await response.json().catch(() => ({}))) as { id?: string; state?: string };
  let state = queued.state ?? "Pending";
  const deadline = Date.now() + SMS_GATE_CONFIRM_MS;
  while (queued.id && !["Sent", "Delivered", "Failed"].includes(state) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    try {
      const check = await fetch(`${base}/messages/${encodeURIComponent(queued.id)}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (check.ok) state = ((await check.json()) as { state?: string }).state ?? state;
    } catch {
      // Keep the last known state; the text is already queued.
    }
  }
  if (state === "Failed") {
    logger.warn({ messageId: queued.id }, "The SMS gateway phone could not send the message");
    return { ok: false, status: "failed" };
  }
  if (state === "Delivered") return { ok: true, status: "delivered" };
  if (state === "Sent") return { ok: true, status: "sent" };
  // Accepted by the gateway; the phone may be waking up. Not claimed as sent.
  return { ok: true, status: "queued" };
}

export async function sendSms(phone: string, text: string, ttlSeconds?: number): Promise<boolean> {
  return (await sendSmsDetailed(phone, text, ttlSeconds)).ok;
}

export async function sendSmsDetailed(phone: string, text: string, ttlSeconds?: number): Promise<SmsResult> {
  if (!smsConfigured()) return { ok: false, status: "not-configured" };
  if (undeliverablePhone(phone)) return { ok: false, status: "blocked" };
  try {
    if (process.env.SMS_PROVIDER === "sms-gate") return await sendViaSmsGate(phone, text, ttlSeconds);
    let response: Response;
    switch (process.env.SMS_PROVIDER) {
      case "semaphore": {
        const form = new URLSearchParams({
          apikey: process.env.SEMAPHORE_API_KEY!,
          number: phone,
          message: text,
        });
        if (process.env.SEMAPHORE_SENDER_NAME) {
          form.set("sendername", process.env.SEMAPHORE_SENDER_NAME);
        }
        response = await post("https://api.semaphore.co/api/v4/messages", {
          method: "POST",
          body: form,
        });
        break;
      }
      case "twilio": {
        const sid = process.env.TWILIO_ACCOUNT_SID!;
        const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
        response = await post(
          `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
          {
            method: "POST",
            headers: { authorization: `Basic ${auth}` },
            body: new URLSearchParams({
              To: toInternational(phone),
              From: process.env.TWILIO_FROM_NUMBER!,
              Body: text,
            }),
          },
        );
        break;
      }
      case "android-gateway": {
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (process.env.SMS_GATEWAY_USER) {
          headers.authorization = `Basic ${Buffer.from(
            `${process.env.SMS_GATEWAY_USER}:${process.env.SMS_GATEWAY_PASSWORD ?? ""}`,
          ).toString("base64")}`;
        }
        response = await post(`${process.env.SMS_GATEWAY_URL!.replace(/\/+$/, "")}/message`, {
          method: "POST",
          headers,
          body: JSON.stringify({ message: text, phoneNumbers: [toInternational(phone)] }),
        });
        break;
      }
      default:
        return { ok: false, status: "not-configured" };
    }
    if (!response.ok) {
      logger.warn(
        { status: response.status, body: (await response.text()).slice(0, 300) },
        "SMS delivery failed",
      );
      return { ok: false, status: "failed" };
    }
    return { ok: true, status: "sent" };
  } catch (err) {
    logger.warn({ err }, "SMS delivery failed");
    return { ok: false, status: "failed" };
  }
}
