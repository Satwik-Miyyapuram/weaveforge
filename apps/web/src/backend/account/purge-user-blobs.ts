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
  await loadCore();
  const registry = new PostgrestBlobRegistry(admin);
  const rows = await registry.listForUser(userId);
  const config = readStorageConfig();
  const failed: BlobRow[] = [];
  if (readyCore().purgesObjects(config.provider, rows.length)) {
    const store = buildStore(config, registry);
    for (const row of rows) {
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
    throw new Error(readyCore().purgeFailureMessage(failed.length, rows.length));
  }

  await registry.deleteForUser(userId);
}

async function removeStoragePrefix(
  admin: SupabaseClient,
  bucket: string,
  prefix: string,
): Promise<void> {
  const core = readyCore();
  const page = core.storageListPage();
  const queue = [prefix];
  const paths: string[] = [];

  while (queue.length) {
    const current = queue.pop()!;
    for (let offset = 0; ; offset += page) {
      const { data, error } = await admin.storage
        .from(bucket)
        .list(current, { limit: page, offset });
      /* Returning here skipped the rest of the bucket and reported success, so a
         listing failure looked exactly like an empty bucket. */
      if (error) throw error;

      const split = core.splitStorageListing(
        current,
        (data ?? []).map((entry) => ({ name: entry.name, isFile: Boolean(entry.id) })),
      );
      paths.push(...split.files);
      queue.push(...split.folders);
      if (!core.storageListingHasMore(data?.length ?? 0)) break;
    }
  }

  if (paths.length) {
    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) throw error;
  }
}
