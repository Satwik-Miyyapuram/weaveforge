/**
 * Blob storage config and S3 client settings (Rust `storage::config` and
 * `storage::blob_client`), re-exported from index.ts.
 */
import {
  blobProviderForRuntime as rawBlobProviderForRuntime,
  coldBlobClientConfig as rawColdBlobClientConfig,
  missingR2ConfigMessage as rawMissingR2ConfigMessage,
  r2BlobClientConfig as rawR2BlobClientConfig,
  readStorageConfig as rawReadStorageConfig,
} from "../pkg/wf_wasm.js";

import type {
  BlobClientConfig,
  BlobProviderId,
  BlobRuntime,
  ColdFields,
  R2Fields,
  StorageConfig,
} from "./bindings.js";

export type {
  BlobClientConfig,
  BlobProviderId,
  BlobRuntime,
  ColdFields,
  R2Fields,
  StorageConfig,
};

/** Drops unset (undefined) env values: the wasm side reads only string values. */
function definedEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/** Read blob/tiering config from an env bag (undefined values are unset). */
export function readStorageConfig(env: Readonly<Record<string, string | undefined>>): StorageConfig {
  return rawReadStorageConfig(definedEnv(env)) as StorageConfig;
}

/** The provider to use: the browser follows the inlined public `tiered` setting. */
export function blobProviderForRuntime(
  configured: BlobProviderId,
  runtime: BlobRuntime,
): BlobProviderId {
  return rawBlobProviderForRuntime(configured, runtime) as BlobProviderId;
}

/** R2 hot-tier client settings, or null when any R2 field is unset or empty. */
export function r2BlobClientConfig(fields: R2Fields): BlobClientConfig | null {
  return rawR2BlobClientConfig(fields) as BlobClientConfig | null;
}

/** Cold-tier client settings, or null when any cold field is unset or empty. */
export function coldBlobClientConfig(fields: ColdFields): BlobClientConfig | null {
  return rawColdBlobClientConfig(fields) as BlobClientConfig | null;
}

/** The error text for unset R2 env vars (names only, never values). */
export function missingR2ConfigMessage(fields: R2Fields): string {
  return rawMissingR2ConfigMessage(fields) as string;
}
