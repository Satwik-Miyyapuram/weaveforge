import type { SupabaseClient } from "@supabase/supabase-js";
import { createRestClient } from "@/backend/providers/postgrest/client";
import type { BlobTier, IBlobStore, ICurrentUserProvider } from "@weaveforge/core";
import { readBackendConfig } from "@/backend/config";
import { getPgPool } from "@/backend/providers/postgres/pool";
import { PgRunner } from "@/backend/providers/postgres/pg-runner";
import { readStorageConfig, type StorageConfig } from "../config";
import { coldBlobConfig, missingR2ConfigError, r2BlobConfig, S3BlobStore } from "../providers/s3/s3-blob-store";
import { PostgresBlobRegistry } from "@/storage/providers/postgres/blob-registry";
import { PostgrestBlobRegistry } from "../providers/postgrest/blob-registry";
import { TieredBlobStore } from "../providers/tiered/tiered-blob-store";

class FixedUserSession implements ICurrentUserProvider {
  constructor(private readonly uid: string) {}

  async getCurrentUserId(): Promise<string | null> {
    return this.uid;
  }

  async requireUserId(): Promise<string> {
    return this.uid;
  }
}

/** What the server says when a deployment setting is missing; the names go to the log. */
function notConfigured(missing: string): Error {
  console.error(`[blobs] missing server setting: ${missing}`);
  return new Error("Blob storage is not configured.");
}

function blobRegistryForUser(databaseUrl: string, userId: string): PostgresBlobRegistry {
  return new PostgresBlobRegistry(new PgRunner(getPgPool(databaseUrl), new FixedUserSession(userId)));
}

/**
 * Blob registry scoped to the caller. The route has already verified the token
 * and passes the user id it got, so this makes no auth round trip (10-04).
 *
 * Typed as the concrete registries rather than `IBlobRegistry`: the signed-urls
 * route mints up to 200 URLs in one request, and the batched read and batched
 * access-counter bump (`getMany` / `recordAccessMany`) are how that stays two
 * round trips instead of six hundred. They are extras on the adapters,
 * deliberately not additions to the shared port, which `packages/core` owns.
 */
export async function blobRegistryForToken(
  accessToken: string,
  userId: string,
): Promise<PostgrestBlobRegistry | PostgresBlobRegistry> {
  const backend = readBackendConfig();
  if (backend.provider === "postgres" && backend.databaseUrl) {
    return blobRegistryForUser(backend.databaseUrl, userId);
  }
  return new PostgrestBlobRegistry(dataClientForToken(accessToken));
}

/** Tiered blob store scoped to the caller (registry RLS). */
export async function buildTieredBlobStoreForToken(
  accessToken: string,
  userId: string,
  config: StorageConfig = readStorageConfig(),
): Promise<IBlobStore> {
  const stores = hotColdStores(config);
  return new TieredBlobStore({ ...stores, registry: await blobRegistryForToken(accessToken, userId) });
}

let cachedStores: { key: string; stores: { hot: S3BlobStore; cold: S3BlobStore } } | null = null;

/**
 * The hot and cold S3 stores, built once per config rather than per request
 * (10-05). Keyed on the settings they read, so a changed config builds anew.
 */
export function hotColdStores(config: StorageConfig = readStorageConfig()): { hot: S3BlobStore; cold: S3BlobStore } {
  const hotCfg = r2BlobConfig(config);
  if (!hotCfg) throw missingR2ConfigError(config);
  const coldCfg = coldBlobConfig(config);
  const key = JSON.stringify([hotCfg, coldCfg]);
  if (cachedStores?.key !== key) {
    const hot = S3BlobStore.fromConfig(hotCfg);
    const cold = coldCfg ? S3BlobStore.fromConfig(coldCfg) : hot;
    cachedStores = { key, stores: { hot, cold } };
  }
  return cachedStores.stores;
}

/** Stream a registered blob from hot or cold tier (server-side only). */
export async function streamBlobObject(
  tier: BlobTier,
  bucket: string,
  path: string,
  config: StorageConfig = readStorageConfig(),
): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string } | null> {
  const stores = hotColdStores(config);
  const store = tier === "cold" ? stores.cold : stores.hot;
  return store.readObject(bucket, path);
}

/** Data client scoped to the caller's JWT (registry RLS). */
function dataClientForToken(accessToken: string): SupabaseClient {
  const backend = readBackendConfig();
  const url = backend.supabaseUrl;
  const anonKey = backend.supabaseAnonKey;
  if (!url || !anonKey) throw notConfigured("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createRestClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

