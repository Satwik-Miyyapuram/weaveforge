import { readyCore } from "@/lib/rust-core";

/** Hot/cold blob provider ids — env-selected at the composition root. */
export type BlobProviderId = "supabase" | "tiered";

/** Env bag for tests and composition-root overrides (avoids full ProcessEnv in unit tests). */
export type EnvReader = Record<string, string | undefined>;

export interface StorageConfig {
  /** Primary blob adapter. Production runs `tiered`; `supabase` is the legacy fallback when unset. */
  readonly provider: BlobProviderId;
  readonly hotQuotaGb: number;
  readonly hotHighWatermark: number;
  readonly hotLowWatermark: number;
  readonly tierBatchSize: number;
  readonly tierAlpha: number;
  readonly tierBeta: number;
  readonly tierGamma: number;
  readonly promoteOnAccess: boolean;
  /** R2 / S3 hot tier (Phase 1+). */
  readonly r2AccountId?: string;
  readonly r2AccessKeyId?: string;
  readonly r2SecretAccessKey?: string;
  readonly r2Bucket?: string;
  /** MinIO / OCI cold tier (Phase 3+). */
  readonly coldEndpoint?: string;
  readonly coldAccessKeyId?: string;
  readonly coldSecretAccessKey?: string;
  readonly coldBucket?: string;
}

/**
 * Read blob/tiering config from env (composition root only). The parsing lives
 * in the Rust core (`storage::config`); this only picks the env bag.
 * Needs the core loaded: await `loadCore()` first.
 */
export function readStorageConfig(env?: EnvReader): StorageConfig {
  // The literal process.env.NEXT_PUBLIC_BLOB_PROVIDER read is what Next.js
  // inlines into the client bundle, where process.env is otherwise empty.
  return readyCore().readStorageConfig(
    env ?? { ...process.env, NEXT_PUBLIC_BLOB_PROVIDER: process.env.NEXT_PUBLIC_BLOB_PROVIDER },
  ) as StorageConfig;
}
