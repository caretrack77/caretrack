import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption at rest for sensitive data (consultation messages, lab result files),
 * supporting the Data Privacy Act of 2012 (RA 10173) requirement to protect personal
 * health information.
 *
 * Algorithm: AES-256-GCM (authenticated encryption: tampering is detected on decrypt).
 * Each value gets a fresh random 96-bit IV. Stored format: "enc:v1:<iv>:<tag>:<ciphertext>" (base64).
 * The 256-bit key comes from DATA_ENCRYPTION_KEY, or is derived from SESSION_SECRET.
 */

const PREFIX = "enc:v1:";
let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const configured = process.env.DATA_ENCRYPTION_KEY;
  const secret = configured || process.env.SESSION_SECRET;
  if (!secret) throw new Error("DATA_ENCRYPTION_KEY or SESSION_SECRET must be set.");
  cachedKey = createHash("sha256").update(`caretrack-data:${secret}`).digest();
  return cachedKey;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptBuffer(plain: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return `${PREFIX}${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptBuffer(value: string): Buffer {
  if (!isEncrypted(value)) return Buffer.from(value, "utf8");
  const [iv, tag, data] = value.slice(PREFIX.length).split(":");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]);
}

export const encryptText = (plain: string): string => encryptBuffer(Buffer.from(plain, "utf8"));

/** Decrypts a stored value. Older plain-text values (from before encryption) are returned as-is. */
export function decryptText(value: string): string {
  try {
    return decryptBuffer(value).toString("utf8");
  } catch {
    return "[This message could not be decrypted]";
  }
}
