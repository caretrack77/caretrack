import { createSign } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, pushTokensTable } from "@workspace/db";
import { logger } from "./logger";

type FirebaseServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

type GoogleAccessToken = {
  access_token: string;
  expires_in: number;
};

type FcmErrorResponse = {
  error?: {
    status?: string;
    message?: string;
    details?: { errorCode?: string }[];
  };
};

let warnedMissingCredentials = false;
let cachedAccessToken: { value: string; expiresAt: number } | null = null;

function serviceAccount(): FirebaseServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    if (!warnedMissingCredentials) {
      logger.warn("FCM is not configured; Android message notifications will not be delivered while the app is closed");
      warnedMissingCredentials = true;
    }
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("project_id" in parsed) ||
      typeof parsed.project_id !== "string" ||
      !parsed.project_id.trim() ||
      !("client_email" in parsed) ||
      typeof parsed.client_email !== "string" ||
      !parsed.client_email.trim() ||
      !("private_key" in parsed) ||
      typeof parsed.private_key !== "string" ||
      !parsed.private_key.trim()
    ) {
      throw new Error("Firebase service account must include project_id, client_email, and private_key.");
    }
    return {
      project_id: parsed.project_id,
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    };
  } catch (error) {
    logger.error({ err: error }, "FIREBASE_SERVICE_ACCOUNT_JSON is invalid");
    return null;
  }
}

export function pushDeliveryConfigured(): boolean {
  return serviceAccount() !== null;
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

async function accessToken(account: FirebaseServiceAccount): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value;
  }

  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  )}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(account.private_key.replace(/\\n/g, "\n")).toString("base64url")}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const result: unknown = await response.json();
  if (
    !response.ok ||
    typeof result !== "object" ||
    result === null ||
    !("access_token" in result) ||
    typeof result.access_token !== "string" ||
    !("expires_in" in result) ||
    typeof result.expires_in !== "number"
  ) {
    throw new Error(`Google OAuth token request failed (${response.status}).`);
  }

  const token: GoogleAccessToken = {
    access_token: result.access_token,
    expires_in: result.expires_in,
  };
  cachedAccessToken = {
    value: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
  return token.access_token;
}

function fcmErrorCode(error: FcmErrorResponse["error"]): string | undefined {
  return error?.details?.find((detail) => detail.errorCode)?.errorCode ?? error?.status;
}

/** Sends a generic, privacy-safe message alert to each registered device for these users. */
export async function sendMessagePush(
  userIds: number[],
  options: {
    notificationId: number;
    url: string;
    kind: "message" | "staff-message" | "coverage";
    title?: string;
    body?: string;
  },
): Promise<void> {
  const uniqueUserIds = [...new Set(userIds)];
  if (uniqueUserIds.length === 0) return;

  const account = serviceAccount();
  if (!account) return;

  const devices = await db
    .select({ userId: pushTokensTable.userId, token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(inArray(pushTokensTable.userId, uniqueUserIds));
  if (devices.length === 0) return;

  let bearer: string;
  try {
    bearer = await accessToken(account);
  } catch (error) {
    logger.error({ err: error }, "Could not authenticate with Firebase Cloud Messaging");
    return;
  }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`;
  for (const device of devices) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          message: {
            token: device.token,
            notification: {
              title: options.title ?? (options.kind === "staff-message" ? "New CareTrack team message" : "New CareTrack message"),
              body: options.body ?? "Open CareTrack to read your message.",
            },
            data: {
              url: options.url,
              kind: options.kind,
              notificationId: String(options.notificationId),
            },
            android: {
              priority: "HIGH",
              notification: {
                channel_id: "caretrack-alerts-v2",
                sound: "default",
              },
            },
          },
        }),
      });

      if (response.ok) continue;

      const result = await response.json().catch(() => null) as FcmErrorResponse | null;
      const code = fcmErrorCode(result?.error);
      logger.error(
        { userId: device.userId, status: response.status, code },
        "Firebase Cloud Messaging rejected a message notification",
      );
      if (code === "UNREGISTERED" || (response.status === 404 && code === "NOT_FOUND")) {
        await db
          .delete(pushTokensTable)
          .where(and(eq(pushTokensTable.userId, device.userId), eq(pushTokensTable.token, device.token)));
      }
    } catch (error) {
      logger.error({ err: error, userId: device.userId }, "Could not send a Firebase Cloud Messaging alert");
    }
  }
}
