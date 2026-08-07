import type { IBlobStore } from "@weaveforge/core";
import type { SupabaseClient } from "@supabase/supabase-js";

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
