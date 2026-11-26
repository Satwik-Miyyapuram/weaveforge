/**
 * A unique temp name for a write that is renamed into `path` next: `<path>.<8 hex>.part`. Two writers never share
 * one, and a file the user keeps at `<path>.part` is never the temp file.
 */
export function tempPathFor(path: string): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${path}.${hex}.part`;
}

/** True for a name `tempPathFor` makes. */
export function isTempPath(path: string): boolean {
  return /\.[0-9a-f]{8}\.part$/.test(path);
}
