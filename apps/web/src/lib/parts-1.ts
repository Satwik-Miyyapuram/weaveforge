import { readyCore } from "@/lib/rust-core";
import type { IBlobFetcher, ICurrentUserProvider } from "@weaveforge/core";
import { isSessionLost, isSignedOutRefusal, SESSION_LOST_MESSAGE } from "./parts";

// --- bucket-asset-store ---
const SIGNED_TTL_S = 3600;

/**
 * A private bucket holding one feature's uploads, keyed `{userId}/{ownerId}/{uuid}.{ext}`.
 *
 * The user-id prefix is what RLS reads, so it is part of the path rather than
 * a column. Everything else here is the same four calls against {@link IBlobStore}
 * that report images, vault assets and paper images each used to spell out
 * for themselves — the bucket name was the only thing that differed.
 */
export class BucketAssetStore {
  constructor(
    protected readonly bucket: string,
    protected readonly blobs: IBlobFetcher,
    protected readonly session: ICurrentUserProvider,
  ) {}

  async upload(ownerId: string, blob: Blob, ext: string): Promise<string> {
    const userId = await this.session.requireUserId();
    const path = `${userId}/${ownerId}/${crypto.randomUUID()}.${ext}`;
    await this.blobs.upload(this.bucket, path, blob, blob.type);
    return path;
  }

  async remove(path: string): Promise<void> {
    await this.blobs.remove(this.bucket, path);
  }

  async signedUrls(paths: string[]): Promise<(string | null)[]> {
    return this.blobs.signedUrls(this.bucket, paths, SIGNED_TTL_S);
  }

  async fetchBlob(path: string): Promise<Blob> {
    return this.blobs.fetchBlob(this.bucket, path);
  }

  /**
   * A blob that fails is left out rather than failing the batch: these are
   * images in a note, and one that cannot be read should leave a gap, not
   * blank the page.
   */
  async fetchBlobs(paths: readonly string[]): Promise<Map<string, Blob>> {
    return this.blobs.fetchBlobs(this.bucket, paths);
  }
}

// --- image-compress ---
/**
 * Client-side image compression: decode → downscale to a max dimension →
 * re-encode as WebP via canvas. Cuts multi-MB screenshots to tens of KB before
 * they hit storage. Falls back to JPEG when the browser can't encode WebP
 * (older Safari); the returned blob's `type` says which one you got.
 */

export interface CompressedImage {
  blob: Blob;
  /** "webp" | "jpeg" — matches the blob's actual encoding. */
  ext: string;
}

const MAX_DIM = 1600;
const QUALITY = 0.82;

/**
 * Files at or below this are left alone when they are already in a format we
 * would have produced.
 *
 * The trade, stated plainly: a 40 KB WebP screenshot is decoded, redrawn and
 * re-encoded to save a few kilobytes and lose a little quality, and everything
 * in between is CPU the person who dropped the file waits for. Below this size
 * the original bytes are kept instead.
 *
 * What is given up: a file that is small *and* enormous in pixels keeps its
 * full resolution, because knowing the dimensions requires the decode this is
 * avoiding. Storage is the only cost — the file is already small, and the note
 * renders it scaled — so it is the cheap side of the trade.
 */
export async function compressImage(
  file: File,
  { maxDim = MAX_DIM, quality = QUALITY }: { maxDim?: number; quality?: number } = {},
): Promise<CompressedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files can be attached.");
  }
  // Pure rule in Rust (`can_store_unchanged`): a WebP or JPEG at or under the threshold above.
  if (readyCore().canStoreUnchanged(file.type, file.size)) {
    return { blob: file, ext: file.type === "image/webp" ? "webp" : "jpeg" };
  }
  // `imageOrientation: "from-image"` is what applies a phone photo's EXIF
  // rotation. It is the spec default in current engines, so this changes nothing
  // there — it is written out so the behaviour does not depend on a default, and
  // the fallback keeps a browser that does not know the option working.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() =>
    createImageBitmap(file),
  );
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable in this browser.");
    ctx.drawImage(bitmap, 0, 0, w, h);

    const webp = await toBlob(canvas, "image/webp", quality);
    if (webp?.type === "image/webp") return { blob: webp, ext: "webp" };
    const jpeg = await toBlob(canvas, "image/jpeg", quality);
    if (jpeg) return { blob: jpeg, ext: "jpeg" };
    throw new Error("Image encoding failed.");
  } finally {
    bitmap.close();
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Minutes east of UTC on this device at the instant `iso` names, for the Rust date formatters.
 * Taken per date so a summer date shown in winter keeps its own offset. 0 when `iso` is unparsable.
 */
export function localOffset(iso: string): number {
  const minutes = -new Date(iso).getTimezoneOffset();
  return Number.isNaN(minutes) ? 0 : minutes;
}
