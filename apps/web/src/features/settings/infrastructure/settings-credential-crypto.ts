import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readBackendConfig } from "@/backend/config";

/**
 * Server-side sealing for reusable integration credentials (Zotero / GitLab /
 * Semantic Scholar keys). Replaces the old client-keyring E2EE path after the
 * drop: the secret payload is encrypted with a server-held key (AES-256-GCM) and
 * stored in user_settings.credentials_enc. Not zero-knowledge — the operator
 * holds the key — but the credentials are unreadable in a raw DB dump, matching
 * the Overleaf token model (overleaf-token-crypto).
 *
 * Runs on the server only (node:crypto). The key is OVERLEAF_CREDENTIAL_KEY,
 * reused as the app's credential key.
 */

type Envelope = { iv: string; ciphertext: string };

function key(): Buffer {
  const secret = readBackendConfig().overleafCredentialKey;
  if (!secret) throw new Error("OVERLEAF_CREDENTIAL_KEY is not configured on the server.");
  return createHash("sha256").update(secret).digest();
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
function unb64(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

/** Seal an arbitrary secret string (typically JSON) into a portable envelope. */
export function sealCredentialString(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return JSON.stringify({ iv: b64(iv), ciphertext: b64(ciphertext) } satisfies Envelope);
}

export function openCredentialString(envelope: string): string {
  let parsed: Envelope;
  try {
    parsed = JSON.parse(envelope) as Envelope;
  } catch {
    throw new Error("Stored credential envelope is invalid.");
  }
  const raw = unb64(parsed.ciphertext);
  if (raw.length <= 16) throw new Error("Stored credential envelope is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", key(), unb64(parsed.iv));
  decipher.setAuthTag(raw.subarray(-16));
  return Buffer.concat([decipher.update(raw.subarray(0, -16)), decipher.final()]).toString("utf8");
}
