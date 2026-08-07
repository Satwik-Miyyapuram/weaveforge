import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BlobTier, IBlobRegistry, IBlobStore, ICurrentUserProvider } from "@weaveforge/core";
import { readBackendConfig } from "@/backend/config";
import { getPgPool } from "@/backend/providers/postgres/pool";
import { PgRunner } from "@/backend/providers/postgres/pg-runner";
import { buildTieredBlobStoreFromConfig, buildTieredBlobStoreFromRegistry } from "../build-tiered-blob-store";
import { readStorageConfig, type StorageConfig } from "../config";
import { coldBlobConfig, r2BlobConfig, S3BlobStore } from "../providers/s3/s3-blob-store";
import { PostgresBlobRegistry } from "@/storage/providers/postgres/blob-registry";
import { SupabaseBlobRegistry } from "../providers/supabase/blob-registry";

/** Server-side tiered store (API routes, tier job). */
export function buildTieredBlobStore(db: SupabaseClient, config: StorageConfig = readStorageConfig()): IBlobStore {
  return buildTieredBlobStoreFromConfig(db, config);
}

class FixedUserSession implements ICurrentUserProvider {
  constructor(private readonly uid: string) {}

  async getCurrentUserId(): Promise<string | null> {
    return this.uid;
  }

  async requireUserId(): Promise<string> {
    return this.uid;
  }
}

/** Resolve caller uid from Supabase Auth JWT (Option A — auth stays on Supabase). */
export async function userIdFromToken(accessToken: string): Promise<string> {
  const db = supabaseClientForToken(accessToken);
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new Error("Not authenticated.");
  return data.user.id;
}

function blobRegistryForUser(userId: string): IBlobRegistry {
  const backend = readBackendConfig();
  if (backend.provider === "postgres" && backend.databaseUrl) {
    const pg = new PgRunner(getPgPool(backend.databaseUrl), new FixedUserSession(userId));
    return new PostgresBlobRegistry(pg);
  }
  throw new Error("buildTieredBlobStoreForUser requires postgres backend or use supabase client.");
}

/** Tiered blob store scoped to the authenticated user (registry RLS). */
export async function buildTieredBlobStoreForToken(
  accessToken: string,
  config: StorageConfig = readStorageConfig(),
): Promise<IBlobStore> {
  const uid = await userIdFromToken(accessToken);
  const backend = readBackendConfig();
  if (backend.provider === "postgres" && backend.databaseUrl) {
    return buildTieredBlobStoreFromRegistry(config, blobRegistryForUser(uid));
  }
  const db = supabaseClientForToken(accessToken);
  return buildTieredBlobStoreFromConfig(db, config);
}

/** Blob registry scoped to the authenticated user (signed URL minting). */
export async function blobRegistryForToken(accessToken: string): Promise<IBlobRegistry> {
  const uid = await userIdFromToken(accessToken);
  const backend = readBackendConfig();
  if (backend.provider === "postgres" && backend.databaseUrl) {
    return blobRegistryForUser(uid);
  }
  const db = supabaseClientForToken(accessToken);
  return new SupabaseBlobRegistry(db);
}

function hotColdStores(config: StorageConfig = readStorageConfig()): { hot: S3BlobStore; cold: S3BlobStore } {
  const hotCfg = r2BlobConfig(config);
  if (!hotCfg) throw new Error("Tiered storage requires R2_* env vars.");
  const hot = S3BlobStore.fromConfig(hotCfg);
  const coldCfg = coldBlobConfig(config);
  const cold = coldCfg ? S3BlobStore.fromConfig(coldCfg) : hot;
  return { hot, cold };
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

/** Supabase client scoped to the caller's JWT (registry RLS). */
export function supabaseClientForToken(accessToken: string): SupabaseClient {
  const backend = readBackendConfig();
  const url = backend.supabaseUrl;
  const anonKey = backend.supabaseAnonKey;
  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export function bearerToken(request: Request): string | null {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
}
