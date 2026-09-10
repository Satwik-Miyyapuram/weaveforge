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

/** Reject path traversal and writes outside the caller's `{userId}/` prefix. */
export function assertBlobPathOwned(path: string, userId: string): void {
  if (!path || path.includes("..") || path.startsWith("/") || path.includes("\\")) {
    throw new Error("Invalid blob path.");
  }
  const prefix = `${userId}/`;
  if (!path.startsWith(prefix) || path.length <= prefix.length) {
    throw new Error("Forbidden blob path.");
  }
}

export function assertAllowedBlobBucket(bucket: string): void {
  if (!(BLOB_STORAGE_BUCKETS as readonly string[]).includes(bucket)) {
    throw new Error("Unsupported blob bucket.");
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
