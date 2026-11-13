import { readyCore } from "@/lib/rust-core";
import { materializeBlobImages, type MaterializedBody } from "@weaveforge/core";

// --- image-variants ---
/**
 * A paper figure's bytes: the thumbnail variant first, the full image as the
 * fallback for figures that have no variant yet. Null when neither exists.
 */
export async function fetchPaperImageBlob(
  papers: { fetchImageBlob: (path: string) => Promise<Blob | null> },
  path: string,
): Promise<Blob | null> {
  return (
    (await papers.fetchImageBlob(readyCore().paperImageThumbnailPath(path)).catch(() => null)) ??
    (await papers.fetchImageBlob(path).catch(() => null))
  );
}

/** The batch form of `fetchPaperImageBlob`; a path with neither variant is left out. */
export async function fetchPaperImageBlobs(
  papers: { fetchImageBlobs: (paths: readonly string[]) => Promise<Map<string, Blob>> },
  paths: readonly string[],
): Promise<Map<string, Blob>> {
  const thumbnails = await papers.fetchImageBlobs(paths.map((path) => readyCore().paperImageThumbnailPath(path)));
  const missing = paths.filter((path) => !thumbnails.has(readyCore().paperImageThumbnailPath(path)));
  const fulls = missing.length ? await papers.fetchImageBlobs(missing) : new Map<string, Blob>();
  const out = new Map<string, Blob>();
  for (const path of paths) {
    const blob = thumbnails.get(readyCore().paperImageThumbnailPath(path)) ?? fulls.get(path);
    if (blob) out.set(path, blob);
  }
  return out;
}

// --- paper-images-md ---
/** Prefix embedded paper images use in markdown: `![](paperimg:userId/paperId/file.webp)`. */
export const PAPER_IMAGE_PREFIX = "paperimg:";

export function paperImageMarkdown(path: string, alt = "image"): string {
  return readyCore().markdownImage(`${PAPER_IMAGE_PREFIX}${path}`, alt);
}

/** Collect unique paper image paths referenced in a note body. */
export function paperImagePathsInBody(body: string): string[] {
  return readyCore().imagePathsInBody(body, PAPER_IMAGE_PREFIX);
}

/** Upload any pasted `blob:` image refs and rewrite them to paperimg: paths before save. */
export function materializePaperBlobImages(
  body: string,
  paperId: string,
  upload: (paperId: string, blob: Blob, ext: string) => Promise<string>,
): Promise<MaterializedBody> {
  return materializeBlobImages(body, paperId, upload, PAPER_IMAGE_PREFIX, (text: string) => readyCore().normalizeMarkdownImageSyntax(text));
}
