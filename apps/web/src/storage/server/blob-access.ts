import { createRestClient } from "@/backend/providers/supabase/client";
import type { BlobTier } from "@weaveforge/core";
import { readBackendConfig } from "@/backend/config";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BLOB_STORAGE_BUCKETS = [
  "paper-images",
  "experiment-artifacts",
  "vault-assets",
  "report-images",
] as const;

/** What a share of the resource in a path grants access to. */
const SHARED_AS: Record<string, string> = {
  "paper-images": "paper",
  "experiment-artifacts": "experiment",
  "vault-assets": "vault_page",
  "report-images": "report_section",
};

/**
 * A refusal the caller is responsible for, carrying the status it deserves.
 *
 * These three checks were plain `Error`s, so the only way a route could tell
 * "you sent a bad path" from "R2 refused the delete" was by pattern-matching
 * the message — which `blobs/_shared.ts` did, and which stops working the
 * moment a message is reworded (or, after the error-sanitising change, replaced
 * before it is looked at). A type is the thing to branch on; the message is for
 * the reader.
 *
 * `status` is on the error rather than derived from the name for the same
 * reason: which HTTP refusal a guard deserves is a property of the guard, not
 * of the call site that happens to catch it.
 */
export class BlobAccessError extends Error {
  constructor(
    message: string,
    /** 400 for a malformed request, 403 for a well-formed one aimed at someone else's data. */
    readonly status: 400 | 403,
  ) {
    super(message);
    this.name = "BlobAccessError";
  }
}

/** Reject path traversal and writes outside the caller's `{userId}/` prefix. */
export function assertBlobPathOwned(path: string, userId: string): void {
  if (!path || path.includes("..") || path.startsWith("/") || path.includes("\\")) {
    // Malformed: no user id makes this path acceptable, so it is the caller's
    // request that is wrong, not their identity.
    throw new BlobAccessError("Invalid blob path.", 400);
  }
  const prefix = `${userId}/`;
  if (!path.startsWith(prefix) || path.length <= prefix.length) {
    // Well-formed and aimed at somebody else's folder. A different user could
    // send the identical request successfully, so this is a refusal, not a
    // malformed request.
    throw new BlobAccessError("Forbidden blob path.", 403);
  }
}

export function assertAllowedBlobBucket(bucket: string): void {
  if (!(BLOB_STORAGE_BUCKETS as readonly string[]).includes(bucket)) {
    throw new BlobAccessError("Unsupported blob bucket.", 400);
  }
}

/** Every bucket keys its objects `{ownerId}/{resourceId}/{file}`. */
export function resourceIdFromBlobPath(path: string): string | null {
  const seg = path.split("/")[1];
  return seg && UUID_RE.test(seg) ? seg : null;
}

async function sharedResourceToUser(
  resourceType: string,
  resourceId: string,
  viewerUid: string,
): Promise<boolean> {
  const backend = readBackendConfig();
  const url = backend.supabaseUrl;
  const serviceKey = backend.supabaseServiceRoleKey;
  if (!url || !serviceKey) return false;
  const admin = createRestClient(url, serviceKey);
  const { data, error } = await admin.rpc("shared_to_user", {
    rtype: resourceType,
    rid: resourceId,
    uid: viewerUid,
  });
  return !error && data === true;
}

/** The owner, or someone the resource behind the blob is shared with, may view it. */
export async function resolveBlobTierForViewer(
  bucket: string,
  path: string,
  viewerUid: string,
): Promise<BlobTier | null> {
  const backend = readBackendConfig();
  const url = backend.supabaseUrl;
  const serviceKey = backend.supabaseServiceRoleKey;
  if (!url || !serviceKey) return null;

  const admin = createRestClient(url, serviceKey);
  const { data, error } = await admin
    .from("blob_objects")
    .select("user_id, tier")
    .eq("bucket", bucket)
    .eq("path", path)
    .maybeSingle();
  if (error || !data) return null;

  const tier: BlobTier = data.tier === "cold" ? "cold" : "hot";
  if (data.user_id === viewerUid) return tier;

  const shared = SHARED_AS[bucket];
  const resourceId = shared ? resourceIdFromBlobPath(path) : null;
  if (shared && resourceId && (await sharedResourceToUser(shared, resourceId, viewerUid))) return tier;
  return null;
}
