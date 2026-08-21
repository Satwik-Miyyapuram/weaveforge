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

/**
 * Purge a user's blobs from object storage and the registry (service role).
 *
 * Called from `deleteOwnAccount` before the account row and the auth user go.
 * That ordering is why this must not paper over a failure: the registry is the
 * only index of which objects a user owns, and the auth user is the only thing
 * tying them to a person. Delete both while an object is still in the bucket
 * and that object is unreachable and unattributable for good — after the user
 * asked for their data to be deleted.
 *
 * So a failure stops the purge and is reported. The rows for objects that
 * could not be removed are kept, because they are the record of what is still
 * out there, and the caller can retry.
 */
export async function purgeUserBlobs(
  admin: SupabaseClient,
  userId: string,
  /* Injected so the failure paths can be tested without object storage. */
  buildStore: typeof buildTieredBlobStoreFromRegistry = buildTieredBlobStoreFromRegistry,
): Promise<void> {
  const { data: rows, error } = await admin
    .from("blob_objects")
    .select("bucket, path")
    .eq("user_id", userId);
  if (error) throw error;

  const config = readStorageConfig();
  const failed: BlobRow[] = [];
  if (config.provider === "tiered" && rows?.length) {
    const store = buildStore(config, new SupabaseBlobRegistry(admin));
    for (const row of rows as BlobRow[]) {
      try {
        await store.remove(row.bucket, row.path);
      } catch {
        failed.push(row);
      }
    }
  }

  for (const bucket of STORAGE_BUCKETS) {
    await removeStoragePrefix(admin, bucket, userId);
  }

  if (failed.length) {
    /* Their rows stay: they are what a retry needs to find the objects. */
    throw new Error(
      `Could not delete ${failed.length} of ${rows?.length ?? 0} stored objects — account not deleted. Retry once object storage is reachable.`,
    );
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
    /* Returning here skipped the rest of the bucket and reported success, so a
       listing failure looked exactly like an empty bucket. */
    if (error) throw error;

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
