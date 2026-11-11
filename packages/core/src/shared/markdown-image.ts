/**
 * Building the markdown that references an image.
 *
 * Every surface that stores images — vault notes, report sections, paper notes —
 * writes the same `![alt](prefix:path)` and differs only in the prefix. The
 * escaping was written out twice and forgotten once, which left the vault
 * writing an alt text straight from the filename: a screenshot called
 * `figure [2].png` produced `![figure [2].png](vault:…)`, and the link stopped
 * being a link. There is one implementation now, in Rust, and the prefix is an
 * argument. What stays here is the blob upload, which does IO.
 */

import { rust } from "./rust.js";

/** One `![alt](head rest)` ref, with `text` the whole match (Rust `FoundImageRef`). */
export type FoundImageRef = { alt: string; head: string; rest: string; text: string };

/** The body with its blob refs rewritten, and why any upload failed. */
export type MaterializedBody = { body: string; uploadError?: Error };

/**
 * Upload every pasted `blob:` ref and rewrite it to a stored path.
 *
 * A ref that cannot be uploaded keeps its original text: a broken image the
 * user can see beats a silent deletion from their own text. A stale blob URL
 * is the browser's loss and is kept quietly; a failed *upload* is reported in
 * `uploadError`, so the caller can save the rest and still say so.
 */
export async function materializeBlobImages(
  body: string,
  ownerId: string,
  upload: (ownerId: string, blob: Blob, ext: string) => Promise<string>,
  prefix: string,
  normalize: (b: string) => string,
): Promise<MaterializedBody> {
  const normalized = normalize(body);
  let result = normalized;
  const failures: unknown[] = [];
  const refs = rust().findImageRefs(normalized, "blob:", true);
  for (const ref of refs) {
    let blob: Blob;
    try {
      const res = await fetch(ref.head + ref.rest);
      if (!res.ok) continue;
      blob = await res.blob();
    } catch {
      continue; // stale blob URL: keep the original ref
    }
    try {
      const path = await upload(ownerId, blob, rust().imageExtensionForMime(blob.type));
      // A function, so `$&`, `$$` and the like in the alt text are not expanded.
      result = result.replace(ref.text, () => rust().markdownImage(`${prefix}${path}`, ref.alt || "image"));
    } catch (err) {
      failures.push(err);
    }
  }
  return { body: result, uploadError: uploadFailure(failures) };
}

function uploadFailure(failures: unknown[]): Error | undefined {
  if (!failures.length) return undefined;
  const first = failures[0];
  const reason = first instanceof Error ? first.message : String(first);
  const what = failures.length === 1 ? "An image could not be uploaded" : `${failures.length} images could not be uploaded`;
  return new Error(`${what}: ${reason}`);
}
