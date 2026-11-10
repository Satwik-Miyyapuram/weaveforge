import type { IBlobRegistry, IBlobStore } from "@weaveforge/core";
import type { StorageConfig } from "./config";
import { readyCore } from "@/lib/rust-core";
import { missingR2ConfigError, S3BlobStore, type S3BlobStoreConfig } from "./providers/s3/s3-blob-store";
import { TieredBlobStore } from "./providers/tiered/tiered-blob-store";

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
