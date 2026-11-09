export const PRIVACY_NOTICE_VERSION = "2026-11";

export function otpOfflineFallbackAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.OTP_OFFLINE_FALLBACK !== undefined) return env.OTP_OFFLINE_FALLBACK === "true";
  return env.NODE_ENV !== "production";
}
