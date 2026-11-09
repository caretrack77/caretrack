export type CareTrackRole = "admin" | "provider" | "patient" | "caregiver";

export function canSendMessage(role: CareTrackRole): boolean {
  return role === "patient" || role === "provider" || role === "admin";
}

export function canManageClinicalRecords(role: CareTrackRole): boolean {
  return role === "provider" || role === "admin";
}

