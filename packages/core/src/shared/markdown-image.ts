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
