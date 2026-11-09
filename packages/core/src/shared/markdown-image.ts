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

interface ImageRef {
  alt: string;
  /** `head` matched at the start of the target. */
  head: RegExpExecArray;
  /** The target after `head`; never empty. */
  rest: string;
  /** The whole `![alt](target)`. */
  text: string;
}

/**
 * Same result as `body.replace(/!\[([^\]]*)\]\((HEAD)([^)\s]+)\)/g, …)`, in linear
 * time; that regex backtracks quadratically on "![![![…" and "![](x:![](x:…".
 * `fn` returns the replacement, or null to keep the ref as written. With
 * `allowSpace` the target may hold whitespace, as in `[^)]+`.
 */
function replaceImageRefs(
  body: string,
  head: RegExp,
  fn: (ref: ImageRef) => string | null,
  allowSpace = false,
): string {
  const sticky = new RegExp(head.source, "y");
  const isEnd = (i: number) => body[i] === ")" || (!allowSpace && /\s/.test(body[i]!));
  // Every start inside one run of target characters ends where the run ends.
  let runFrom = -1;
  let runEnd = -1;
  const targetEnd = (s: number) => {
    if (s < runFrom || s > runEnd) {
      let i = s;
      while (i < body.length && !isEnd(i)) i += 1;
      runFrom = s;
      runEnd = i;
    }
    return runEnd;
  };
  let out = "";
  let copied = 0;
  let from = 0;
  for (;;) {
    const start = body.indexOf("![", from);
    if (start < 0) break;
    const close = body.indexOf("]", start + 2);
    if (close < 0) break;
    // Every "![" before `close` shares this "]" and what follows, so one try covers them all.
    from = close + 1;
    if (body[close + 1] !== "(") continue;
    const s = close + 2;
    const end = targetEnd(s);
    if (body[end] !== ")") continue;
    sticky.lastIndex = s;
    const m = sticky.exec(body);
    if (!m || s + m[0].length >= end) continue;
    const text = body.slice(start, end + 1);
    const replaced = fn({ alt: body.slice(start + 2, close), head: m, rest: body.slice(s + m[0].length, end), text });
    from = end + 1;
    if (replaced === null) continue;
    out += body.slice(copied, start) + replaced;
    copied = from;
  }
  return out + body.slice(copied);
}

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
  const refs: ImageRef[] = [];
  const failures: unknown[] = [];
  replaceImageRefs(normalized, /blob:/, (ref) => (refs.push(ref), null), true);
  for (const ref of refs) {
    let blob: Blob;
    try {
      const res = await fetch(ref.head[0] + ref.rest);
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
