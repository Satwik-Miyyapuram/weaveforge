/**
 * Seals and opens stored integration credentials with AES-256-GCM, in the same
 * envelope the relay reads: `{"iv": b64url, "ciphertext": b64url(ciphertext || tag)}`.
 *
 * The key is SHA-256 of the untrimmed secret (`OVERLEAF_CREDENTIAL_KEY`).
 *
 * Bound envelopes add `"bound": true` and authenticate `(user_id, scope, name)`
 * as AES-GCM associated data, so a value copied to another user, scope or name
 * fails to open. Envelopes without the marker (written before AAD existed, or
 * by the relay) open without AAD and are re-sealed bound on their next write.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const CREDENTIAL_KEY_ENV = "OVERLEAF_CREDENTIAL_KEY";

export type CredentialScope = "account" | `workspace:${string}`;

export type CredentialBinding = {
  userId: string;
  scope: CredentialScope;
  name: string;
};

export function isCredentialScope(value: string): value is CredentialScope {
  return value === "account" || /^workspace:.+$/.test(value);
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

function keyFor(secret: string | undefined): Buffer {
  if (!secret) throw new Error(`${CREDENTIAL_KEY_ENV} is not configured on the server.`);
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Canonical AAD: a JSON array, so no field can be confused with another. */
function aadFor(binding: CredentialBinding): Buffer {
  return Buffer.from(
    JSON.stringify(["wf-credential-v1", binding.userId, binding.scope, binding.name]),
    "utf8",
  );
}

export function sealCredential(
  plain: string,
  secret: string | undefined,
  binding?: CredentialBinding,
  iv: Buffer = randomBytes(IV_BYTES),
): string {
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  if (binding) cipher.setAAD(aadFor(binding));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  const envelope: Record<string, unknown> = {
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
  if (binding) envelope.bound = true;
  return JSON.stringify(envelope);
}

export function openCredential(envelope: string, secret: string | undefined, binding?: CredentialBinding): string {
  let parsed: { iv?: unknown; ciphertext?: unknown; bound?: unknown };
  try {
    parsed = JSON.parse(envelope);
  } catch {
    throw new Error("Stored credential envelope is invalid (not JSON).");
  }
  const raw = typeof parsed.ciphertext === "string" ? Buffer.from(parsed.ciphertext, "base64url") : Buffer.alloc(0);
  if (raw.length <= TAG_BYTES) throw new Error("Stored credential envelope is invalid (ciphertext too short).");
  const key = keyFor(secret);
  const iv = typeof parsed.iv === "string" ? Buffer.from(parsed.iv, "base64url") : Buffer.alloc(0);
  if (iv.length !== IV_BYTES) throw new Error("Stored credential could not be decrypted (bad IV).");

  if (parsed.bound === true) {
    if (!binding) throw new Error("Bound credential requires its binding to open.");
    return decrypt(key, iv, raw, aadFor(binding));
  }
  // Legacy: sealed without AAD. Readable under any binding; re-sealed bound on write.
  return decrypt(key, iv, raw);
}

function decrypt(key: Buffer, iv: Buffer, raw: Buffer, aad?: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
  try {
    return Buffer.concat([decipher.update(raw.subarray(0, raw.length - TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Stored credential could not be decrypted (auth tag mismatch: wrong key or altered data).");
  }
}
