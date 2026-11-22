import type { BlobRef } from "./ports";

/** A blob ref with the names it is written under: `assets/<bucket>/<path>`. */
export type SafeBlobRef = { ref: BlobRef; bucket: string; path: string; unsafe: boolean };

const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * One path segment made safe for Windows and POSIX: ':' and NUL become '_', a trailing run of
 * dots or spaces becomes '_' per character, and a reserved device name (CON, COM1, ...) gets a
 * leading '_'. Empty, '.' and '..' are left as they are so the caller can reject them.
 */
function safeSegment(segment: string): string {
  let out = segment.replace(/[:\u0000]/g, "_").replace(/[. ]+$/, (run) => "_".repeat(run.length));
  const base = out.split(".")[0] ?? "";
  if (RESERVED.test(base)) out = `_${out}`;
  return out;
}

/** `name.ext` becomes `name-<n>.ext`; a name with no extension gets `-<n>` at the end. */
function withSuffix(path: string, n: number): string {
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash + 1);
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${dir}${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${dir}${name}-${n}`;
}

/**
 * Names every blob ref is written under, the same for the blob loop and the verify gate.
 * The refs are sorted first, so the names do not depend on the order the server lists them.
 * A name that collides with an earlier one (case-insensitively) gets a numbered suffix.
 * Unsafe refs are flagged, and the verify gate counts them as failures.
 */
export function sanitizeBlobRefs(refs: readonly BlobRef[]): SafeBlobRef[] {
  const key = (r: BlobRef) => `${r.bucket}\0${r.path}\0${r.sizeBytes}`;
  const sorted = [...refs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const taken = new Set<string>();
  return sorted.map((ref) => {
    const rawSegments = ref.path.split("/");
    const bucket = safeSegment(ref.bucket);
    const path = rawSegments.map(safeSegment).join("/");
    const unsafe =
      !ref.bucket ||
      !ref.path ||
      ref.bucket.includes("/") ||
      ref.bucket.includes("\\") ||
      ref.path.includes("\\") ||
      path.endsWith(".sha256") ||
      [ref.bucket, ...rawSegments].some((s) => s === "" || s === "." || s === "..");
    if (unsafe) return { ref, bucket: ref.bucket, path: ref.path, unsafe };
    let finalPath = path;
    for (let n = 2; taken.has(`${bucket}/${finalPath}`.toLowerCase()); n++) finalPath = withSuffix(path, n);
    taken.add(`${bucket}/${finalPath}`.toLowerCase());
    return { ref, bucket, path: finalPath, unsafe };
  });
}
