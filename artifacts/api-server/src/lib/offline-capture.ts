import type { Request } from "express";

/** Header the app sends with changes it saved on the device: when the user actually made them. */
export const CAPTURED_AT_HEADER = "x-caretrack-captured-at";
/** Changes saved offline are accepted for this long; older ones need the care team. */
export const OFFLINE_SYNC_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Tolerance for a phone clock that runs a little fast. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export type CapturedAt = { at: Date } | { error: string } | null;

/**
 * The time a change was made on the device, from the `x-caretrack-captured-at` header.
 * Null when the header is absent (a normal online request). Times in the future or older
 * than the offline window are refused rather than silently replaced with "now".
 */
export function capturedAt(req: Request): CapturedAt {
  const raw = req.header(CAPTURED_AT_HEADER);
  if (!raw) return null;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return { error: "Invalid capture time." };
  const now = Date.now();
  if (at.getTime() > now + CLOCK_SKEW_MS) return { error: "This change has a time in the future. Check the device clock." };
  if (at.getTime() < now - OFFLINE_SYNC_WINDOW_MS) {
    return { error: "This change was saved on the device more than 7 days ago and can no longer be synced. Ask your care team to record it." };
  }
  return { at: new Date(Math.min(at.getTime(), now)) };
}
