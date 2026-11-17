/**
 * Seals and opens stored integration credentials with AES-256-GCM, in the same
 * envelope the relay reads: `{"iv": b64url, "ciphertext": b64url(ciphertext || tag)}`.
 *
 * The key is SHA-256 of the untrimmed secret (`OVERLEAF_CREDENTIAL_KEY`).
 *
 * Bound envelopes add `"bound": true`, are sealed with an HKDF-derived key, and
 * authenticate `(user_id, scope, name)` as AES-GCM associated data, so a value
 * copied to another user, scope or name fails to open. Envelopes without the
 * marker (written before AAD existed, or by the relay) open with the SHA-256 key
 * and no AAD, and are re-sealed bound on their next write.
 *
 * Relay constraint: the relay (`apps/relay/server/src/credentials.rs`,
 * `overleaf_workshop.rs`, `overleaf_report_content.rs`) reads these envelopes
 * with the SHA-256 key only. It cannot open bound envelopes. Do not write bound
 * envelopes for any credential the relay reads until `credential_crypto.rs` has
 * a bound reader; until then such reads fail closed.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

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

/** Legacy/relay key: SHA-256 of the secret. Used by envelopes without the bound marker. */
function keyFor(secret: string | undefined): Buffer {
  if (!secret) throw new Error(`${CREDENTIAL_KEY_ENV} is not configured on the server.`);
  return createHash("sha256").update(secret, "utf8").digest();
}

/**
 * Bound key: HKDF-SHA256 of the same secret under a distinct info label. The
 * `bound` marker is not authenticated, so a bound envelope must not open under
 * the legacy key even if the marker is stripped (or added to a legacy envelope).
 * Stripping fails the GCM tag check; the relay (legacy key only) cannot open
 * bound envelopes and fails closed until it has a bound reader.
 */
function boundKeyFor(secret: string | undefined): Buffer {
  if (!secret) throw new Error(`${CREDENTIAL_KEY_ENV} is not configured on the server.`);
  const ikm = createHash("sha256").update(secret, "utf8").digest();
  return Buffer.from(hkdfSync("sha256", ikm, Buffer.alloc(0), "wf-credential-v1-bound", 32));
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
  const cipher = createCipheriv("aes-256-gcm", binding ? boundKeyFor(secret) : keyFor(secret), iv);
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
  const iv = typeof parsed.iv === "string" ? Buffer.from(parsed.iv, "base64url") : Buffer.alloc(0);
  if (iv.length !== IV_BYTES) throw new Error("Stored credential could not be decrypted (bad IV).");

  if (parsed.bound === true) {
    if (!binding) throw new Error("Bound credential requires its binding to open.");
    return decrypt(boundKeyFor(secret), iv, raw, aadFor(binding));
  }
  // Legacy: sealed without AAD under keyFor. Readable under any binding; re-sealed bound on write.
  return decrypt(keyFor(secret), iv, raw);
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
