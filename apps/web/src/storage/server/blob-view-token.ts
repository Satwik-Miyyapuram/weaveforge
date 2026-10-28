import { createHmac, timingSafeEqual } from "node:crypto";
import type { BlobTier } from "@weaveforge/core";

export interface BlobViewPayload {
  uid: string;
  bucket: string;
  path: string;
  tier: BlobTier;
  exp: number;
}

/** Its own key only: a leaked view token must not say anything about the service-role or R2 secret. */
function blobViewSecret(): string {
  const secret = process.env.BLOB_VIEW_SECRET;
  if (secret) return secret;
  throw new Error("Set BLOB_VIEW_SECRET for tiered blob viewing (`openssl rand -base64 48`).");
}

export function mintBlobViewToken(payload: BlobViewPayload, secret = blobViewSecret()): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyBlobViewToken(token: string, secret = blobViewSecret()): BlobViewPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let payload: BlobViewPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as BlobViewPayload;
  } catch {
    return null;
  }
  if (!payload.uid || !payload.bucket || !payload.path || !payload.tier) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/**
 * Expiries round up to this step, so signing the same blob again within it
 * gives the same URL and the browser can reuse what it already downloaded.
 * A token lives at most one step longer than asked.
 */
export const BLOB_VIEW_STEP_S = 300;

export function blobContentUrl(
  origin: string,
  payload: Omit<BlobViewPayload, "exp">,
  ttlSeconds: number,
  secret?: string,
  nowMs = Date.now(),
): string {
  const exp = Math.ceil((Math.floor(nowMs / 1000) + ttlSeconds) / BLOB_VIEW_STEP_S) * BLOB_VIEW_STEP_S;
  const token = mintBlobViewToken({ ...payload, exp }, secret ?? blobViewSecret());
  return `${origin}/api/blobs/content?t=${encodeURIComponent(token)}`;
}

/** The viewer's own browser may keep the bytes until the token expires; nothing shared may. */
export function blobCacheControl(exp: number, nowMs = Date.now()): string {
  const left = exp - Math.floor(nowMs / 1000);
  return left > 0 ? `private, max-age=${left}, immutable` : "private, no-store";
}
