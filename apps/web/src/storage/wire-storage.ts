import type { IBlobStore } from "@weaveforge/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readStorageConfig, type BlobProviderId, type StorageConfig } from "./config";
import { HttpBlobStore } from "./providers/http/http-blob-store";
import { SupabaseBlobStore } from "./providers/supabase/blob-store";

export interface WireStorageDeps {
  /** Required when provider = supabase. */
  supabaseDb?: SupabaseClient;
  config?: StorageConfig;
}

/** The browser follows the inlined public setting; the server follows its config. */
export function blobProviderForRuntime(
  configured: BlobProviderId,
  runtime: { inBrowser: boolean; publicProvider: string | undefined },
): BlobProviderId {
  return runtime.inBrowser && runtime.publicProvider === "tiered" ? "tiered" : configured;
}

/**
 * Composition-root helper: pick blob adapter from env.
 * Tiered mode uses {@link HttpBlobStore} in the browser (R2/MinIO secrets stay server-side).
 *
 * This module is in the browser bundle, so it must not import the S3 stores:
 * that pulled the AWS SDK into every page. Server code builds tiered storage
 * through `storage/server/blob-api`.
 */
export function wireStorage(deps: WireStorageDeps): IBlobStore {
  const config = deps.config ?? readStorageConfig();
  const provider = blobProviderForRuntime(config.provider, {
    inBrowser: typeof window !== "undefined",
    // Literal read: Next.js inlines it into the browser bundle.
    publicProvider: process.env.NEXT_PUBLIC_BLOB_PROVIDER,
  });
  switch (provider) {
    case "tiered":
      if (typeof window !== "undefined") {
        return new HttpBlobStore();
      }
      throw new Error("Server-side tiered storage is built by storage/server/blob-api, not wireStorage.");
    case "supabase":
    default: {
      if (!deps.supabaseDb) {
        throw new Error("Supabase blob storage requires a Supabase client.");
      }
      return new SupabaseBlobStore(deps.supabaseDb);
    }
  }
}
