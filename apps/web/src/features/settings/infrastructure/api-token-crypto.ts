import { createHash, randomBytes } from "node:crypto";

export const API_TOKEN_PREFIX = "tt_";
const TOKEN_BYTES = 32;

export interface GeneratedApiToken {
  plaintext: string;
  hash: Uint8Array;
  prefix: string;
}

/** One-time plaintext token + SHA-256 hash for storage. */
export function generateApiToken(): GeneratedApiToken {
  const body = randomBytes(TOKEN_BYTES).toString("base64url");
  const plaintext = `${API_TOKEN_PREFIX}${body}`;
  return {
    plaintext,
    hash: hashApiToken(plaintext),
    prefix: `${plaintext.slice(0, API_TOKEN_PREFIX.length + 8)}…`,
  };
}

export function hashApiToken(plaintext: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(plaintext, "utf8").digest());
}

export function isApiTokenFormat(token: string): boolean {
  return token.startsWith(API_TOKEN_PREFIX) && token.length > API_TOKEN_PREFIX.length + 16;
}

/** Longest expiry a client may ask for: 100 years. */
const MAX_EXPIRY_DAYS = 36_500;

/** True for a valid expiry request: null/undefined (never) or 0..100 years in whole days. */
export function isExpiryDays(days: unknown): days is number | null | undefined {
  return days == null || (Number.isInteger(days) && (days as number) >= 0 && (days as number) <= MAX_EXPIRY_DAYS);
}

/** Map UI expiry choice to timestamptz (null = never). */
export function expiryFromDays(days: number | null | undefined): string | null {
  if (days == null || days <= 0) return null;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
