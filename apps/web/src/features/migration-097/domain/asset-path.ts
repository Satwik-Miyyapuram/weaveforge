/**
 * True when a blob's bucket and path cannot be written under `assets/<bucket>/<path>` safely:
 * empty parts, separators or traversal, or a name that collides with a `.sha256` sidecar.
 * Same rule as the local blob store (backend/providers/files/file-blob-store.ts).
 */
export function isUnsafeAssetPath(bucket: string, path: string): boolean {
  return (
    !bucket ||
    !path ||
    bucket.includes("/") ||
    [bucket, path].some((part) => part.includes("..") || part.startsWith("/") || part.includes("\\")) ||
    path.endsWith(".sha256")
  );
}
