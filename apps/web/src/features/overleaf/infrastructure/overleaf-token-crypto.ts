import { openCredentialString, sealCredentialString } from "@/features/settings/infrastructure/settings-credential-crypto";

/**
 * Overleaf tokens use the app's credential envelope (AES-256-GCM under
 * OVERLEAF_CREDENTIAL_KEY). Same format as before, so stored tokens still open.
 */
export function sealOverleafToken(token: string): string {
  return sealCredentialString(token);
}

export function openOverleafToken(envelope: string): string {
  return openCredentialString(envelope);
}
