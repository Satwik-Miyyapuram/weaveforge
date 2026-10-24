import type { IBlobStore } from "@weaveforge/core";
import { getDataClient } from "@/lib/data-client";
import { logToApp } from "@/lib/error-report/app-log";
import { MAX_SIGNED_URL_PATHS } from "@/storage/signed-url-limits";

/**
 * Browser-safe blob adapter when `BLOB_PROVIDER=tiered`.
 * R2/MinIO credentials stay server-side; calls `/api/blobs/*` routes.
 */
async function sessionAccessToken(): Promise<string | null> {
  const { data } = await getDataClient().auth.getSession();
  return data.session?.access_token ?? null;
}

/** Throws the route's own error message, or `<label> failed (<status>)`. */
async function throwIfNotOk(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? `${label} failed (${res.status})`);
}

export class HttpBlobStore implements IBlobStore {
  constructor(private readonly accessToken: () => Promise<string | null> = sessionAccessToken) {}

  private async authHeaders(): Promise<HeadersInit> {
    const token = await this.accessToken();
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
    await throwIfNotOk(res, "Upload");
  }

  async remove(bucket: string, path: string): Promise<void> {
    const res = await fetch("/api/blobs/remove", {
      method: "POST",
      headers: { ...(await this.authHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({ bucket, path }),
    });
    await throwIfNotOk(res, "Delete");
  }

  async signedUrls(
    bucket: string,
    paths: string[],
    ttlSeconds: number,
  ): Promise<(string | null)[]> {
    if (paths.length === 0) return [];
    // The route caps one request, so a long list is sent in batches rather
    // than rejected — a gallery with 300 images should render, not blank.
    // The batches go out together; Promise.all keeps them in input order.
    const batches: string[][] = [];
    for (let i = 0; i < paths.length; i += MAX_SIGNED_URL_PATHS) {
      batches.push(paths.slice(i, i + MAX_SIGNED_URL_PATHS));
    }
    const answers = await Promise.all(batches.map((batch) => this.signedUrlBatch(bucket, batch, ttlSeconds)));
    return answers.flat();
  }

  private async signedUrlBatch(
    bucket: string,
    paths: string[],
    ttlSeconds: number,
  ): Promise<(string | null)[]> {
    const res = await fetch("/api/blobs/signed-urls", {
      method: "POST",
      headers: { ...(await this.authHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({ bucket, paths, ttlSeconds }),
    });
    if (!res.ok) {
      // Still no URLs (the images show as missing), but say why.
      logToApp({
        level: "warn",
        source: "blobs",
        message: "Signed URL batch refused",
        detail: `POST /api/blobs/signed-urls returned ${res.status}`,
      });
      return paths.map(() => null);
    }
    const body = (await res.json()) as { urls?: (string | null)[] };
    return body.urls ?? paths.map(() => null);
  }
}
