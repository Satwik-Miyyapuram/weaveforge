import type { SupabaseClient } from "@supabase/supabase-js";
import { readStorageConfig } from "@/storage/config";
import { buildTieredBlobStoreFromRegistry } from "@/storage/build-tiered-blob-store";
import { SupabaseBlobRegistry } from "@/storage/providers/supabase/blob-registry";

const STORAGE_BUCKETS = [
  "paper-images",
  "experiment-artifacts",
  "vault-assets",
  "report-images",
] as const;

interface BlobRow {
  bucket: string;
  path: string;
}

/** Best-effort purge of a user's blobs from object storage + registry (service role). */
export async function purgeUserBlobs(admin: SupabaseClient, userId: string): Promise<void> {
  const { data: rows, error } = await admin
    .from("blob_objects")
    .select("bucket, path")
    .eq("user_id", userId);
  if (error) throw error;

  const config = readStorageConfig();
  if (config.provider === "tiered" && rows?.length) {
    const store = buildTieredBlobStoreFromRegistry(config, new SupabaseBlobRegistry(admin));
    for (const row of rows as BlobRow[]) {
      try {
        await store.remove(row.bucket, row.path);
      } catch {
        /* object may already be gone */
      }
    }
  }

  for (const bucket of STORAGE_BUCKETS) {
    await removeStoragePrefix(admin, bucket, userId);
  }

  await admin.from("blob_objects").delete().eq("user_id", userId);
}

async function removeStoragePrefix(
  admin: SupabaseClient,
  bucket: string,
  prefix: string,
): Promise<void> {
  const queue = [prefix];
  const paths: string[] = [];

  while (queue.length) {
    const current = queue.pop()!;
    const { data, error } = await admin.storage.from(bucket).list(current, { limit: 200 });
    if (error) return;

    for (const entry of data ?? []) {
      const full = current ? `${current}/${entry.name}` : entry.name;
      if (entry.id) {
        paths.push(full);
      } else {
        queue.push(full);
      }
    }
  }

  if (paths.length) {
    await admin.storage.from(bucket).remove(paths);
  }
}
