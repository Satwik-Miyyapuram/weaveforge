import { createHmac, timingSafeEqual } from "node:crypto";
import type { BlobTier } from "@weaveforge/core";

export interface BlobViewPayload {
  uid: string;
  bucket: string;
  path: string;
  tier: BlobTier;
  exp: number;
}

export function blobViewSecret(): string {
  const explicit = process.env.BLOB_VIEW_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (explicit) return explicit;
  const r2Secret = process.env.R2_SECRET_ACCESS_KEY;
  if (r2Secret) return `blob-view:${r2Secret}`;
  throw new Error(
    "Set BLOB_VIEW_SECRET, SUPABASE_SERVICE_ROLE_KEY, or R2_SECRET_ACCESS_KEY for tiered blob viewing.",
  );
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

export function blobContentUrl(
  origin: string,
  payload: Omit<BlobViewPayload, "exp">,
  ttlSeconds: number,
  secret?: string,
): string {
  const token = mintBlobViewToken(
    {
      ...payload,
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    },
    secret ?? blobViewSecret(),
  );
  return `${origin}/api/blobs/content?t=${encodeURIComponent(token)}`;
}
