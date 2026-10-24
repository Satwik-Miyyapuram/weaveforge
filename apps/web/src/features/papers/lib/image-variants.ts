/** Deterministic private-object variant names; contents remain E2EE blobs. */
export function paperImageThumbnailPath(path: string): string {
  const match = /^(.*?)(?:\.full)?\.[^.]+$/.exec(path);
  return match ? `${match[1]}.thumb.webp` : `${path}.thumb.webp`;
}

/**
 * A paper figure's bytes: the thumbnail variant first, the full image as the
 * fallback for figures that have no variant yet. Null when neither exists.
 */
export async function fetchPaperImageBlob(
  papers: { fetchImageBlob: (path: string) => Promise<Blob | null> },
  path: string,
): Promise<Blob | null> {
  return (
    (await papers.fetchImageBlob(paperImageThumbnailPath(path)).catch(() => null)) ??
    (await papers.fetchImageBlob(path).catch(() => null))
  );
}

/** The batch form of `fetchPaperImageBlob`; a path with neither variant is left out. */
export async function fetchPaperImageBlobs(
  papers: { fetchImageBlobs: (paths: readonly string[]) => Promise<Map<string, Blob>> },
  paths: readonly string[],
): Promise<Map<string, Blob>> {
  const thumbnails = await papers.fetchImageBlobs(paths.map(paperImageThumbnailPath));
  const missing = paths.filter((path) => !thumbnails.has(paperImageThumbnailPath(path)));
  const fulls = missing.length ? await papers.fetchImageBlobs(missing) : new Map<string, Blob>();
  const out = new Map<string, Blob>();
  for (const path of paths) {
    const blob = thumbnails.get(paperImageThumbnailPath(path)) ?? fulls.get(path);
    if (blob) out.set(path, blob);
  }
  return out;
}
