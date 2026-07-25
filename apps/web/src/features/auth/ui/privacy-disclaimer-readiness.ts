/**
 * Pure gate for PrivacyDisclaimerGate: when a cached startup snapshot says the
 * disclaimer is already accepted, shell children must still wait for the full
 * container (cold reopen / TWA / website).
 */
export function shouldMountShellChildren(input: {
  loading: boolean;
  needsPrivacyAccept: boolean;
  containerReady: boolean;
}): boolean {
  return !input.loading && !input.needsPrivacyAccept && input.containerReady;
}

export function shouldShowWorkspaceLoader(input: {
  loading: boolean;
  needsPrivacyAccept: boolean;
  containerReady: boolean;
  error: string | null;
}): boolean {
  if (input.loading) return true;
  if (!input.needsPrivacyAccept && !input.containerReady && !input.error) return true;
  return false;
}
