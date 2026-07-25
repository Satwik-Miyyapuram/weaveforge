import type { IBlobStore } from "@thesis/core";
import { getSupabase } from "@/lib/supabase";

/**
 * Browser-safe blob adapter when `BLOB_PROVIDER=tiered`.
 * R2/MinIO credentials stay server-side; calls `/api/blobs/*` routes.
 */
export class HttpBlobStore implements IBlobStore {
  private async authHeaders(): Promise<HeadersInit> {
    const { data } = await getSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Not authenticated.");
    return { Authorization: `Bearer ${token}` };
  }

  async upload(bucket: string, path: string, blob: Blob, contentType?: string): Promise<void> {
    const form = new FormData();
    form.set("bucket", bucket);
    form.set("path", path);
    form.set("file", blob, path.split("/").pop() ?? "file");
    if (contentType) form.set("contentType", contentType);
    const res = await fetch("/api/blobs/upload", {
      method: "POST",
      headers: await this.authHeaders(),
      body: form,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Upload failed (${res.status})`);
    }
  }

  async remove(bucket: string, path: string): Promise<void> {
    const res = await fetch("/api/blobs/remove", {
      method: "POST",
      headers: { ...(await this.authHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({ bucket, path }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Delete failed (${res.status})`);
    }
  }

  async signedUrls(
    bucket: string,
    paths: string[],
    ttlSeconds: number,
  ): Promise<(string | null)[]> {
    if (paths.length === 0) return [];
    const res = await fetch("/api/blobs/signed-urls", {
      method: "POST",
      headers: { ...(await this.authHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({ bucket, paths, ttlSeconds }),
    });
    if (!res.ok) return paths.map(() => null);
    const body = (await res.json()) as { urls?: (string | null)[] };
    return body.urls ?? paths.map(() => null);
  }
}
