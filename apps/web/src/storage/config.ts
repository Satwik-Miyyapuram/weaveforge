/** Hot/cold blob provider ids — env-selected at the composition root. */
type BlobProviderId = "supabase" | "tiered";

/** Env bag for tests and composition-root overrides (avoids full ProcessEnv in unit tests). */
export type EnvReader = Record<string, string | undefined>;

export interface StorageConfig {
  /** Primary blob adapter (default: supabase until cutover). */
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

const PROVIDERS = ["supabase", "tiered"] as const;

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : fallback;
}

function parseFloatEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function blobProviderFromEnv(env: EnvReader): BlobProviderId {
  return pick(env.NEXT_PUBLIC_BLOB_PROVIDER ?? env.BLOB_PROVIDER, PROVIDERS, "supabase");
}

function fromEnv(env: EnvReader): StorageConfig {
  return {
    provider: blobProviderFromEnv(env),
    hotQuotaGb: parseFloatEnv(env.BLOB_HOT_QUOTA_GB, 10),
    hotHighWatermark: parseFloatEnv(env.BLOB_HOT_HIGH_WATERMARK, 0.85),
    hotLowWatermark: parseFloatEnv(env.BLOB_HOT_LOW_WATERMARK, 0.75),
    tierBatchSize: parseIntEnv(env.BLOB_TIER_BATCH_SIZE, 100),
    tierAlpha: parseFloatEnv(env.BLOB_TIER_ALPHA, 1),
    tierBeta: parseFloatEnv(env.BLOB_TIER_BETA, 30),
    tierGamma: parseFloatEnv(env.BLOB_TIER_GAMMA, 0.5),
    promoteOnAccess: parseBoolEnv(env.BLOB_PROMOTE_ON_ACCESS, true),
    r2AccountId: env.R2_ACCOUNT_ID,
    r2AccessKeyId: env.R2_ACCESS_KEY_ID,
    r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY,
    r2Bucket: env.R2_BUCKET,
    coldEndpoint: env.BLOB_COLD_ENDPOINT,
    coldAccessKeyId: env.BLOB_COLD_ACCESS_KEY_ID,
    coldSecretAccessKey: env.BLOB_COLD_SECRET_ACCESS_KEY,
    coldBucket: env.BLOB_COLD_BUCKET,
  };
}

/** Read blob/tiering config from env (composition root only). */
export function readStorageConfig(env?: EnvReader): StorageConfig {
  if (env) return fromEnv(env);
  // Direct process.env.NEXT_PUBLIC_* access so Next.js inlines provider in the client bundle.
  return {
    provider: pick(
      process.env.NEXT_PUBLIC_BLOB_PROVIDER ?? process.env.BLOB_PROVIDER,
      PROVIDERS,
      "supabase",
    ),
    hotQuotaGb: parseFloatEnv(process.env.BLOB_HOT_QUOTA_GB, 10),
    hotHighWatermark: parseFloatEnv(process.env.BLOB_HOT_HIGH_WATERMARK, 0.85),
    hotLowWatermark: parseFloatEnv(process.env.BLOB_HOT_LOW_WATERMARK, 0.75),
    tierBatchSize: parseIntEnv(process.env.BLOB_TIER_BATCH_SIZE, 100),
    tierAlpha: parseFloatEnv(process.env.BLOB_TIER_ALPHA, 1),
    tierBeta: parseFloatEnv(process.env.BLOB_TIER_BETA, 30),
    tierGamma: parseFloatEnv(process.env.BLOB_TIER_GAMMA, 0.5),
    promoteOnAccess: parseBoolEnv(process.env.BLOB_PROMOTE_ON_ACCESS, true),
    r2AccountId: process.env.R2_ACCOUNT_ID,
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    r2Bucket: process.env.R2_BUCKET,
    coldEndpoint: process.env.BLOB_COLD_ENDPOINT,
    coldAccessKeyId: process.env.BLOB_COLD_ACCESS_KEY_ID,
    coldSecretAccessKey: process.env.BLOB_COLD_SECRET_ACCESS_KEY,
    coldBucket: process.env.BLOB_COLD_BUCKET,
  };
}
