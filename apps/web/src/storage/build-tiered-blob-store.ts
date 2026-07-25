import type { IBlobRegistry, IBlobStore } from "@thesis/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StorageConfig } from "./config";
import { coldBlobConfig, r2BlobConfig, S3BlobStore } from "./providers/s3/s3-blob-store";
import { SupabaseBlobRegistry } from "./providers/supabase/blob-registry";
import { TieredBlobStore } from "./providers/tiered/tiered-blob-store";

function requireHotConfig(config: StorageConfig): void {
  if (!r2BlobConfig(config)) {
    throw new Error("Tiered storage requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.");
  }
}

/** Hot/cold tiered store; cold falls back to hot until MinIO is configured (Phase 3). */
export function buildTieredBlobStoreFromRegistry(
  config: StorageConfig,
  registry: IBlobRegistry,
): IBlobStore {
  requireHotConfig(config);
  const hot = S3BlobStore.fromConfig(r2BlobConfig(config)!);
  const coldCfg = coldBlobConfig(config);
  const cold = coldCfg ? S3BlobStore.fromConfig(coldCfg) : hot;
  return new TieredBlobStore({ hot, cold, registry });
}

/** Hot/cold tiered store via Supabase PostgREST registry. */
export function buildTieredBlobStoreFromConfig(db: SupabaseClient, config: StorageConfig): IBlobStore {
  return buildTieredBlobStoreFromRegistry(config, new SupabaseBlobRegistry(db));
}
