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

// --- format-date ---
/**
 * One date format in the UI (D12, D-01): "1 Jul 2026", "1 Jul 2026, 14:05",
 * and "2h ago" for activity under a week old. ISO stays for inputs and exports.
 */
type DateInput = string | number | Date | null | undefined;

function parse(input: DateInput): Date | null {
  if (input === null || input === undefined || input === "") return null;
  // A bare "YYYY-MM-DD" is a calendar day, not UTC midnight (which is the day
  // before west of Greenwich).
  const day = typeof input === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(input) as [string, string, string, string] | null : null;
  const d = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

export function formatDate(input: DateInput): string {
  const d = parse(input);
  // "Sept" in some ICU builds; the UI says "Sep".
  return d ? DATE.format(d).replace("Sept", "Sep") : "";
}

export function formatDateTime(input: DateInput): string {
  const d = parse(input);
  return d ? `${formatDate(d)}, ${TIME.format(d)}` : "";
}

export function formatRelative(input: DateInput, now: Date = new Date()): string {
  const d = parse(input);
  if (!d) return "";
  const seconds = (now.getTime() - d.getTime()) / 1000;
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(d);
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
