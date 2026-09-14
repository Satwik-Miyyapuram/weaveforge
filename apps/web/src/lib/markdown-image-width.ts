/**
 * An image's display width, written into its alt text.
 *
 * `![diagram|50%](vault:…)` and `![diagram|400](vault:…)` — the suffix Obsidian
 * uses, so a note that leaves for another tool keeps its sizing and one that
 * arrives from it is honoured. The alt text stays the alt text: the renderer
 * strips the suffix before it reaches the `alt` attribute.
 *
 * A width is one of the three placement ideas an image alt can carry (§
 * markdown-figure-alt: width, crop, alignment), so this module is the width
 * face of that grammar: every function here reads and writes through it, so
 * changing a picture's width cannot drop its crop or its placement.
 */

import {
  parseMdImageAlt,
  withMdImageAlt,
  type MdAlign,
  type MdCrop,
} from "./markdown-figure-alt";

export interface ImageAlt {
  alt: string;
  /** `"50%"` or `"400px"`; absent when the alt carries no width. */
  width?: string;
}

export function parseImageAlt(raw: string): ImageAlt {
  const parts = parseMdImageAlt(raw);
  // The width face only: crop and alignment are the figure module's.
  return { alt: parts.alt, ...(parts.width ? { width: parts.width } : {}) };
}

/** The alt text to write for a width, keeping any crop or alignment. */
export function withImageWidth(alt: string, width: string | null): string {
  const parts = parseMdImageAlt(alt);
  return withMdImageAlt(parts.alt, {
    crop: parts.crop ?? null,
    align: parts.align ?? null,
    width,
  });
}

/** Every image reference the renderer accepts, alt and target captured. */
const IMAGE_REF = /!\[([^\]]*)\]\(([^\s)]+)\)/g;

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
    if (parseMdImageAlt(rawAlt).alt !== alt) return match;
    if (seen++ !== ordinal) return match;
    return `![${withImageWidth(rawAlt, width)}](${target})`;
  });
}

/** The placement a figure's alt carries, in the figure module's own types. */
export function parseImagePlacement(raw: string): {
  alt: string;
  crop?: MdCrop;
  align?: MdAlign;
  width?: string;
} {
  return parseMdImageAlt(raw);
}

/** The alt text for a figure's own text plus its placement, all three. */
export function withImagePlacement(
  alt: string,
  placement: { crop?: MdCrop | null; align?: MdAlign | null; width?: string | null },
): string {
  return withMdImageAlt(alt, placement);
}

/**
 * Rewrite the `ordinal`-th image with that alt to a whole placement.
 *
 * The read view's figure control spends this: one click on a picture can
 * change its width, its crop and its side in one write, because three
 * separate writes could land on an alt that moved between them.
 */
export function setImagePlacement(
  body: string,
  alt: string,
  ordinal: number,
  placement: { crop?: MdCrop | null; align?: MdAlign | null; width?: string | null },
): string {
  let seen = 0;
  return body.replace(IMAGE_REF, (match, rawAlt: string, target: string) => {
    if (parseMdImageAlt(rawAlt).alt !== alt) return match;
    if (seen++ !== ordinal) return match;
    return `![${withImagePlacement(rawAlt, placement)}](${target})`;
  });
}
