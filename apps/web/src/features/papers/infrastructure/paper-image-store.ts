import type { IBlobStore, ICurrentUserProvider, IEncryptedBlobStore } from "@weaveforge/core";
import type { IPaperImageStore } from "../domain/zotero";

const BUCKET = "paper-images";
const SIGNED_TTL_S = 3600;
const THUMB_MAX_DIM = 640;

function asEncrypted(store: IBlobStore): IEncryptedBlobStore {
  return store as IEncryptedBlobStore;
}

/**
 * Paper image storage — private bucket, user-id prefix for RLS.
 * Uses {@link IBlobStore} so the backing host (Supabase, R2, S3) is swappable.
 */
export class PaperImageStore implements IPaperImageStore {
  constructor(
    private readonly blobs: IBlobStore,
    private readonly session: ICurrentUserProvider,
  ) {}

  private get encrypted() {
    return asEncrypted(this.blobs);
  }

  async upload(paperId: string, blob: Blob, ext: string): Promise<string> {
    const userId = await this.session.requireUserId();
    const base = `${userId}/${paperId}/${crypto.randomUUID()}`;
    const fullPath = `${base}.full.${ext}`;
    await this.blobs.upload(BUCKET, fullPath, blob, blob.type);
    const thumbnail = await makeThumbnail(blob);
    if (thumbnail) {
      await this.blobs.upload(BUCKET, `${base}.thumb.webp`, thumbnail, "image/webp");
    }
    return fullPath;
  }

  async remove(path: string): Promise<void> {
    await this.blobs.remove(BUCKET, path);
    const thumbnail = path.replace(/\.full\.[^.]+$/, ".thumb.webp");
    if (thumbnail !== path) await this.blobs.remove(BUCKET, thumbnail);
  }

  async signedUrls(paths: string[]): Promise<(string | null)[]> {
    return this.blobs.signedUrls(BUCKET, paths, SIGNED_TTL_S);
  }

  async fetchDecrypted(path: string): Promise<Blob> {
    return this.encrypted.fetchDecrypted(BUCKET, path);
  }

  async fetchDecryptedMany(paths: readonly string[]): Promise<Map<string, Blob>> {
    const many = this.encrypted.fetchDecryptedMany;
    if (!many) {
      throw new Error("Blob store does not support batch fetch");
    }
    return many.call(this.encrypted, BUCKET, paths);
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
