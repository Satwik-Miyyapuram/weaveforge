import { createRestClient } from "@/backend/providers/supabase/client";
import type { BlobTier } from "@weaveforge/core";
import { readBackendConfig } from "@/backend/config";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const BLOB_STORAGE_BUCKETS = [
  "paper-images",
  "experiment-artifacts",
  "vault-assets",
  "report-images",
] as const;

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

/** Paper image path: `{ownerId}/{paperId}/{file}`. */
export function paperIdFromImagePath(path: string): string | null {
  const seg = path.split("/")[1];
  if (!seg || !UUID_RE.test(seg)) return null;
  return seg;
}

/** Vault asset path: `{ownerId}/{pageId}/{file}`. */
export function vaultPageIdFromPath(path: string): string | null {
  const seg = path.split("/")[1];
  if (!seg || !UUID_RE.test(seg)) return null;
  return seg;
}

/** Report image path: `{ownerId}/{sectionId}/{file}`. */
export function reportSectionIdFromImagePath(path: string): string | null {
  const seg = path.split("/")[1];
  if (!seg || !UUID_RE.test(seg)) return null;
  return seg;
}

async function sharedResourceToUser(
  resourceType: "paper" | "vault_page" | "report_section",
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

/** Owner or explicit paper share may view a blob. */
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

  if (bucket === "paper-images") {
    const paperId = paperIdFromImagePath(path);
    if (paperId && (await sharedResourceToUser("paper", paperId, viewerUid))) return tier;
  }
  if (bucket === "vault-assets") {
    const pageId = vaultPageIdFromPath(path);
    if (pageId && (await sharedResourceToUser("vault_page", pageId, viewerUid))) return tier;
  }
  if (bucket === "report-images") {
    const sectionId = reportSectionIdFromImagePath(path);
    if (sectionId && (await sharedResourceToUser("report_section", sectionId, viewerUid))) return tier;
  }
  return null;
}
