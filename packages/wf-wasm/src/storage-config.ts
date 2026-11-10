/**
 * Blob storage config and S3 client settings (Rust `storage::config` and
 * `storage::blob_client`), re-exported from index.ts.
 */
import {
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

export {
  blobProviderForRuntime,
  coldBlobClientConfig,
  missingR2ConfigMessage,
  objectKey,
  r2BlobClientConfig,
  readContentType,
  uploadContentType,
} from "../pkg/wf_wasm.js";

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

