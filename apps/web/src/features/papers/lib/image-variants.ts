import { readyCore } from "@/lib/rust-core";

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
