import type { IBlobStore, ICurrentUserProvider } from "@weaveforge/core";
import { BucketAssetStore } from "@/lib/bucket-asset-store";
import type { IPaperImageStore } from "../domain/zotero";

const THUMB_MAX_DIM = 640;

/**
 * Paper image storage — private bucket, user-id prefix for RLS.
 *
 * Unlike the other buckets this one keeps a second, smaller copy beside each
 * upload, because the library grid shows every image at once and full-size
 * ones make it crawl.
 */
export class PaperImageStore extends BucketAssetStore implements IPaperImageStore {
  constructor(blobs: IBlobStore, session: ICurrentUserProvider) {
    super("paper-images", blobs, session);
  }

  override async upload(paperId: string, blob: Blob, ext: string): Promise<string> {
    const userId = await this.session.requireUserId();
    const base = `${userId}/${paperId}/${crypto.randomUUID()}`;
    const fullPath = `${base}.full.${ext}`;
    await this.blobs.upload(this.bucket, fullPath, blob, blob.type);
    const thumbnail = await makeThumbnail(blob);
    if (thumbnail) {
      await this.blobs.upload(this.bucket, `${base}.thumb.webp`, thumbnail, "image/webp");
    }
    return fullPath;
  }

  override async remove(path: string): Promise<void> {
    await super.remove(path);
    const thumbnail = path.replace(/\.full\.[^.]+$/, ".thumb.webp");
    if (thumbnail !== path) await super.remove(thumbnail);
  }

  /**
   * No one-at-a-time fallback here, on purpose: a paper's images are fetched
   * as a set for the grid, and doing that serially is slow enough to look
   * broken. A store that cannot batch should say so rather than crawl.
   */
  override async fetchDecryptedMany(paths: readonly string[]): Promise<Map<string, Blob>> {
    const many = this.encrypted.fetchDecryptedMany;
    if (!many) throw new Error("Blob store does not support batch fetch");
    return many.call(this.encrypted, this.bucket, paths);
  }
}

async function makeThumbnail(blob: Blob): Promise<Blob | null> {
  if (typeof window === "undefined" || typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, THUMB_MAX_DIM / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.76));
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}
