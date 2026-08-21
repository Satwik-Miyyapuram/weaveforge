/** Deterministic private-object variant names; contents remain E2EE blobs. */
export function paperImageThumbnailPath(path: string): string {
  const match = /^(.*?)(?:\.full)?\.[^.]+$/.exec(path);
  return match ? `${match[1]}.thumb.webp` : `${path}.thumb.webp`;
}
