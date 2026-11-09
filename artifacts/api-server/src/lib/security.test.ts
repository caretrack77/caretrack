import { describe, expect, it } from "vitest";
import { PRIVACY_NOTICE_VERSION, otpOfflineFallbackAllowed } from "./security-config";

describe("security privacy defaults", () => {
  it("disables OTP offline fallback in production unless explicitly enabled", () => {
    expect(otpOfflineFallbackAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(otpOfflineFallbackAllowed({ NODE_ENV: "production", OTP_OFFLINE_FALLBACK: "true" })).toBe(true);
  });

  it("keeps offline fallback available outside production", () => {
    expect(otpOfflineFallbackAllowed({ NODE_ENV: "development" })).toBe(true);
  });

  it("uses a stable current consent version", () => {
    expect(PRIVACY_NOTICE_VERSION).toMatch(/^\d{4}-\d{2}$/);
  });
});
