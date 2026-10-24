/**
 * Building the markdown that references an image.
 *
 * Every surface that stores images — vault notes, report sections, paper notes —
 * writes the same `![alt](prefix:path)` and differs only in the prefix. The
 * escaping was written out twice and forgotten once, which left the vault
 * writing an alt text straight from the filename: a screenshot called
 * `figure [2].png` produced `![figure [2].png](vault:…)`, and the link stopped
 * being a link. There is one implementation now and the prefix is an argument.
 */

/**
 * Makes a string safe to sit inside `[…]`.
 *
 * Newlines collapse to spaces because an alt text is one line by definition,
 * and the three characters that would end the label early are escaped. An empty
 * result becomes "image" rather than `![]`, which reads as a broken image to a
 * screen reader instead of an unlabelled one.
 */
export function escapeMarkdownAltText(alt: string): string {
  const collapsed = alt.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!collapsed) return "image";
  return collapsed.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

/** `![alt](target)`, with the alt text escaped. */
export function markdownImage(target: string, alt = "image"): string {
  return `![${escapeMarkdownAltText(alt)}](${target})`;
}

/**
 * A readable alt text from a file name.
 *
 * The extension goes because "diagram.png" describes a file and "diagram"
 * describes a picture, and the separators most screenshot tools use become
 * spaces. A clipboard bitmap has no name at all — browsers call it `image.png`
 * — so that one is treated as no name rather than as a description.
 */
export function imageAltFromFilename(name: string | undefined): string {
  if (!name) return "image";
  const withoutExtension = name.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  const words = withoutExtension.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!words || /^image$/i.test(words)) return "image";
  return words;
}

/** File extension for a blob's MIME type, defaulting to png. */
export function imageExtensionForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpeg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/svg+xml") return "svg";
  if (mime === "image/avif") return "avif";
  return "png";
}

/**
 * Reading the refs back out.
 *
 * Finding the refs a surface owns, and turning a pasted `blob:` URL into a
 * stored one, were written once per surface — vault, papers, report — and
 * differed only in the prefix, exactly as `markdownImage` once did. `normalize`
 * is passed in because the prefix list it knows about is vault-side, and this
 * file is not the place to grow a second copy of it.
 */
export function imagePathsInBody(body: string, prefix: string, normalize: (b: string) => string): string[] {
  const paths = new Set<string>();
  const head = new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`));
  replaceImageRefs(normalize(body), head, ({ rest }) => {
    paths.add(rest);
    return null;
  });
  return [...paths];
}

export interface ImageRef {
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
export function replaceImageRefs(
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

/** Upload every pasted `blob:` ref and rewrite it to a stored path. A stale
    blob URL keeps its original ref: a broken image the user can see beats a
    silent deletion from their own text. */
export async function materializeBlobImages(
  body: string,
  ownerId: string,
  upload: (ownerId: string, blob: Blob, ext: string) => Promise<string>,
  prefix: string,
  normalize: (b: string) => string,
): Promise<string> {
  const normalized = normalize(body);
  let result = normalized;
  const refs: ImageRef[] = [];
  replaceImageRefs(normalized, /blob:/, (ref) => (refs.push(ref), null), true);
  for (const ref of refs) {
    try {
      const res = await fetch(ref.head[0] + ref.rest);
      if (!res.ok) continue;
      const blob = await res.blob();
      const path = await upload(ownerId, blob, imageExtensionForMime(blob.type));
      // A function, so `$&`, `$$` and the like in the alt text are not expanded.
      result = result.replace(ref.text, () => markdownImage(`${prefix}${path}`, ref.alt || "image"));
    } catch {
      /* stale blob URL — keep the original ref */
    }
  }
  return result;
}
