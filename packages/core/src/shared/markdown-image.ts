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
  const normalized = normalize(body);
  /* Skeleton literal, prefix escaped: a pattern assembled entirely as a string
     loses a backslash to one careless edit and then matches nothing, and a
     regex that matches nothing reads as a note with no images. */
  const re = new RegExp(
    String.raw`!\[[^\]]*\]\(` + prefix.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`) + String.raw`([^)\s]+)\)`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) paths.add(m[1]!);
  return [...paths];
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
  for (const m of [...normalized.matchAll(/!\[([^\]]*)\]\((blob:[^)]+)\)/g)]) {
    try {
      const res = await fetch(m[2]!);
      if (!res.ok) continue;
      const blob = await res.blob();
      const path = await upload(ownerId, blob, imageExtensionForMime(blob.type));
      result = result.replace(m[0], markdownImage(`${prefix}${path}`, m[1] ?? "image"));
    } catch {
      /* stale blob URL — keep the original ref */
    }
  }
  return result;
}
