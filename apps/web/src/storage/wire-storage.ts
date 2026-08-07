import type { IBlobRegistry, IBlobStore } from "@weaveforge/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTieredBlobStoreFromConfig, buildTieredBlobStoreFromRegistry } from "./build-tiered-blob-store";
import { readStorageConfig, type StorageConfig } from "./config";
import { HttpBlobStore } from "./providers/http/http-blob-store";
import { SupabaseBlobStore } from "./providers/supabase/blob-store";

export interface WireStorageDeps {
  /** Required when provider = supabase or server-side tiered (Supabase registry). */
  supabaseDb?: SupabaseClient;
  /** Postgres registry for server-side tiered when backend provider = postgres. */
  blobRegistry?: IBlobRegistry;
  config?: StorageConfig;
}

/**
 * Composition-root helper: pick blob adapter from env.
 * Tiered mode uses {@link HttpBlobStore} in the browser (R2/MinIO secrets stay server-side).
 */
export function wireStorage(deps: WireStorageDeps): IBlobStore {
  const config = deps.config ?? readStorageConfig();
  const provider =
    typeof window !== "undefined" && process.env.NEXT_PUBLIC_BLOB_PROVIDER === "tiered"
      ? "tiered"
      : config.provider;
  switch (provider) {
    case "tiered":
      if (typeof window !== "undefined") {
        return new HttpBlobStore();
      }
      if (deps.blobRegistry) {
        return buildTieredBlobStoreFromRegistry(config, deps.blobRegistry);
      }
      if (!deps.supabaseDb) {
        throw new Error("Server-side tiered storage requires supabaseDb or blobRegistry.");
      }
      return buildTieredBlobStoreFromConfig(deps.supabaseDb, config);
    case "supabase":
    default: {
      if (!deps.supabaseDb) {
        throw new Error("Supabase blob storage requires a Supabase client.");
      }
      return new SupabaseBlobStore(deps.supabaseDb);
    }
  }
}
