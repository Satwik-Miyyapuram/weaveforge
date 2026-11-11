import { readyCore } from "@/lib/rust-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IBlobStore } from "@weaveforge/core";
import { type BlobProviderId, readStorageConfig, type StorageConfig } from "./config";
import { HttpBlobStore } from "./providers/http/http-blob-store";

// --- blob-store ---
/** Supabase Storage adapter for {@link IBlobStore}. */
export class SupabaseBlobStore implements IBlobStore {
  constructor(private readonly db: SupabaseClient) {}

  async upload(bucket: string, path: string, blob: Blob, contentType?: string): Promise<void> {
    const { error } = await this.db.storage.from(bucket).upload(path, blob, {
      contentType: contentType ?? blob.type,
      cacheControl: "31536000",
      upsert: true,
    });
    if (error) throw new Error(`Blob upload failed: ${error.message}`);
  }

  async remove(bucket: string, path: string): Promise<void> {
    const { error } = await this.db.storage.from(bucket).remove([path]);
    if (error) throw new Error(`Blob delete failed: ${error.message}`);
  }

  async signedUrls(
    bucket: string,
    paths: string[],
    ttlSeconds: number,
  ): Promise<(string | null)[]> {
    if (paths.length === 0) return [];
    const { data, error } = await this.db.storage.from(bucket).createSignedUrls(paths, ttlSeconds);
    if (error || !data) return paths.map(() => null);
    const byPath = new Map(data.map((d) => [d.path, d.signedUrl ?? null]));
    return paths.map((p) => byPath.get(p) ?? null);
  }
}

// --- wire-storage ---
export interface WireStorageDeps {
  /** Required when provider = supabase. */
  supabaseDb?: SupabaseClient;
  config?: StorageConfig;
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
  // The browser follows the inlined public setting; the server follows its config.
  const provider = readyCore().blobProviderForRuntime(config.provider, {
    inBrowser: typeof window !== "undefined",
    // Literal read: Next.js inlines it into the browser bundle.
    publicProvider: process.env.NEXT_PUBLIC_BLOB_PROVIDER,
  }) as BlobProviderId;
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
