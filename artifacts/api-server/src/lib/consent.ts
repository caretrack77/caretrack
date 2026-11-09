export function privacyConsentRequired(
  acceptedVersion: string | null | undefined,
  currentVersion: string,
): boolean {
  return acceptedVersion !== currentVersion;
}

