import { loadCore, readyCore } from "@/lib/rust-core";
import { readStorageConfig } from "@/storage/config";
import { PostgrestBlobRegistry } from "@/storage/providers/postgrest/blob-registry";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IBlobRegistry, IBlobStore } from "@weaveforge/core";
import type { StorageConfig } from "../../storage/config";
import {
  missingR2ConfigError,
  S3BlobStore,
  type S3BlobStoreConfig,
} from "../../storage/providers/s3/s3-blob-store";
import { TieredBlobStore } from "../../storage/providers/tiered/tiered-blob-store";

// --- build-tiered-blob-store ---
function requireHotConfig(config: StorageConfig): void {
  if (!(readyCore().r2BlobClientConfig(config) as S3BlobStoreConfig | null)) {
    throw missingR2ConfigError(config);
  }
}

/** Hot/cold tiered store; cold falls back to hot until MinIO is configured (Phase 3). */
export function buildTieredBlobStoreFromRegistry(
  config: StorageConfig,
  registry: IBlobRegistry,
): IBlobStore {
  requireHotConfig(config);
  const hot = S3BlobStore.fromConfig((readyCore().r2BlobClientConfig(config) as S3BlobStoreConfig | null)!);
  const coldCfg = readyCore().coldBlobClientConfig(config) as S3BlobStoreConfig | null;
  const cold = coldCfg ? S3BlobStore.fromConfig(coldCfg) : hot;
  return new TieredBlobStore({ hot, cold, registry });
}

// --- purge-user-blobs ---
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

  await loadCore();
  const config = readStorageConfig();
  const failed: BlobRow[] = [];
  if (config.provider === "tiered" && rows?.length) {
    const store = buildStore(config, new PostgrestBlobRegistry(admin));
    for (const row of rows as BlobRow[]) {
      try {
        await store.remove(row.bucket, row.path);
      } catch {
        failed.push(row);
      }
    }
  }

  for (const bucket of readyCore().blobStorageBuckets()) {
    await removeStoragePrefix(admin, bucket, userId);
  }

  if (failed.length) {
    /* Their rows stay: they are what a retry needs to find the objects. */
    throw new Error(
      `Could not delete ${failed.length} of ${rows?.length ?? 0} stored objects — account not deleted. Retry once object storage is reachable.`,
    );
  }

  const { error: deleteError } = await admin.from("blob_objects").delete().eq("user_id", userId);
  if (deleteError) throw deleteError;
}

/** One listing call returns at most this many entries; longer prefixes are paged. */
const LIST_PAGE = 200;

async function removeStoragePrefix(
  admin: SupabaseClient,
  bucket: string,
  prefix: string,
): Promise<void> {
  const queue = [prefix];
  const paths: string[] = [];

  while (queue.length) {
    const current = queue.pop()!;
    for (let offset = 0; ; offset += LIST_PAGE) {
      const { data, error } = await admin.storage
        .from(bucket)
        .list(current, { limit: LIST_PAGE, offset });
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
      if ((data?.length ?? 0) < LIST_PAGE) break;
    }
  }

  if (paths.length) {
    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) throw error;
  }
}
