import nodemailer from "nodemailer";
import { logger } from "./logger";

/**
 * Sends one-time login codes by email (Gmail SMTP) or SMS.
 *
 * SMS providers (set SMS_PROVIDER in .env):
 *  - "semaphore"        Semaphore (Philippine SMS API, needs internet)
 *  - "twilio"           Twilio (international, needs internet)
 *  - "android-gateway"  "SMS Gateway for Android" app running on a phone on the same
 *                       Wi-Fi network. Works without internet, using the phone's load.
 *
 * Every function returns false instead of throwing when delivery is not configured
 * or fails, so the caller can fall back to showing the code on screen.
 */

const TIMEOUT_MS = 10_000;

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
    case "android-gateway":
      return Boolean(process.env.SMS_GATEWAY_URL);
    default:
      return false;
  }
}

/** Converts Philippine local numbers (09XXXXXXXXX) to international format (+639XXXXXXXXX). */
export function toInternational(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("09") && digits.length === 11) return `+63${digits.slice(1)}`;
  if (digits.startsWith("63")) return `+${digits}`;
  return digits;
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

/** Demo and reserved domains (e.g. admin@caretrack.demo) can't receive mail. */
export function undeliverableEmail(address: string): boolean {
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

export async function sendSms(phone: string, text: string): Promise<boolean> {
  if (!smsConfigured()) return false;
  try {
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
        return false;
    }
    if (!response.ok) {
      logger.warn(
        { status: response.status, body: (await response.text()).slice(0, 300) },
        "SMS delivery failed",
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, "SMS delivery failed");
    return false;
  }
}
