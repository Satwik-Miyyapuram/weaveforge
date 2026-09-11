/**
 * An image's display width, written into its alt text.
 *
 * `![diagram|50%](vault:…)` and `![diagram|400](vault:…)` — the suffix Obsidian
 * uses, so a note that leaves for another tool keeps its sizing and one that
 * arrives from it is honoured. The alt text stays the alt text: the renderer
 * strips the suffix before it reaches the `alt` attribute.
 *
 * Pure string work, shared by the renderer (which reads a width) and the read
 * view's resize control (which writes one), so the two cannot disagree about
 * the spelling.
 */

const WIDTH_SUFFIX = /\|\s*(\d{1,4})(%?)\s*$/;

/** Every image reference the renderer accepts, alt and target captured. */
const IMAGE_REF = /!\[([^\]]*)\]\(([^\s)]+)\)/g;

export interface ImageAlt {
  alt: string;
  /** `"50%"` or `"400px"`; absent when the alt carries no width. */
  width?: string;
}

export function parseImageAlt(raw: string): ImageAlt {
  const m = WIDTH_SUFFIX.exec(raw);
  if (!m) return { alt: raw };
  const n = Number(m[1]);
  const alt = raw.slice(0, m.index).trimEnd();
  if (n <= 0) return { alt };
  return { alt, width: m[2] ? `${Math.min(n, 100)}%` : `${n}px` };
}

/** The alt text to write for a width, or the bare alt for "natural size". */
export function withImageWidth(alt: string, width: string | null): string {
  const bare = parseImageAlt(alt).alt;
  if (!width) return bare;
  const n = Number.parseInt(width, 10);
  if (!Number.isFinite(n) || n <= 0) return bare;
  return `${bare}|${width.endsWith("%") ? `${Math.min(n, 100)}%` : n}`;
}

/**
 * Rewrite the `ordinal`-th image whose (bare) alt is `alt`, in document order.
 *
 * Matched by alt rather than by target because the read view has already
 * swapped every target for a blob URL by the time a picture is clicked, and the
 * blob URL says nothing about the markdown behind it. Returns the body
 * unchanged when nothing matches.
 */
export function setImageWidth(
  body: string,
  alt: string,
  ordinal: number,
  width: string | null,
): string {
  let seen = 0;
  return body.replace(IMAGE_REF, (match, rawAlt: string, target: string) => {
    if (parseImageAlt(rawAlt).alt !== alt) return match;
    if (seen++ !== ordinal) return match;
    return `![${withImageWidth(rawAlt, width)}](${target})`;
  });
}
