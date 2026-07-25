/** Deterministic private-object variant names; contents remain E2EE blobs. */
export function paperImageThumbnailPath(path: string): string {
  const match = /^(.*?)(?:\.full)?\.[^.]+$/.exec(path);
  return match ? `${match[1]}.thumb.webp` : `${path}.thumb.webp`;
}

export function paperImageFullPath(path: string): string {
  if (/\.full\.[^.]+$/.test(path)) return path;
  const match = /^(.*?)(?:\.thumb)\.webp$/.exec(path);
  return match ? `${match[1]}.full.webp` : path;
}
