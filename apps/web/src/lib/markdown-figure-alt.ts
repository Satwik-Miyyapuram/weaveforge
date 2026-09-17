/**
 * A markdown image's crop and alignment, written into its alt text.
 *
 * An ink page places an image with geometry tokens (§figure.ts) because a
 * page is a sheet with coordinates. A markdown note is not a sheet — its text
 * flows, and an image is a figure in the typographic sense: content the
 * column wraps around. So the same grammar shrinks to the two tokens that
 * mean anything in flowing text: `c=` crop insets as percentages of the
 * image's own box (the ink figure's `c`, spelled identically), and an
 * alignment word — `left`, `right` or `center` — that says where in the
 * column the figure sits.
 *
 * `![photo right c=0,0,10,10|60%]` — the placement tokens follow the alt's
 * own text and precede the Obsidian `|width` suffix (§markdown-image-width),
 * so a note keeps one spelling for all three ideas and one that arrives from
 * another tool is honoured the way the width already is. The crop is
 * geometry, not destruction: the bytes are untouched and the crop is undone
 * by clearing the token.
 */

/** The crop insets as they are written, or `null` when there are none. */
export type MdCrop = [number, number, number, number];

/** Where a figure sits in the column. */
export type MdAlign = "left" | "right" | "center";

export interface MdImageAlt {
  /** The alt's own text, everything that is neither a token nor a width. */
  alt: string;
  /** Crop insets `[left, top, right, bottom]`, each 0–99, absent for none. */
  crop?: MdCrop;
  /** Column placement, absent for the document's own default. */
  align?: MdAlign;
  /** `"50%"` or `"400px"`; absent when the alt carries no width. */
  width?: string;
}

const CROP_TOKEN = /\bc=([0-9]{1,3}(?:,[0-9]{1,3}){3})(?![0-9])/;
const ALIGN_WORD = /\b(left|right|center)\b/;

/**
 * Split an image alt into its parts: the alt's own text, its crop, its
 * alignment, and its Obsidian width suffix.
 *
 * The crop and the alignment are stripped from the text the renderer puts in
 * the `alt` attribute — they are placement, not description — and unknown
 * words are left alone: `a right answer` keeps its `right`, because it is
 * text and not the last word of the alt.
 */
export function parseMdImageAlt(raw: string): MdImageAlt {
  // The width suffix first: it is parsed elsewhere and its digits would
  // otherwise read as a crop's.
  const widthMatch = /\|\s*(\d{1,4})(%?)\s*$/.exec(raw);
  const withoutWidth = widthMatch
    ? raw.slice(0, widthMatch.index).trimEnd()
    : raw;

  const cropMatch = CROP_TOKEN.exec(withoutWidth);
  let crop: MdCrop | undefined;
  let rest = withoutWidth;
  if (cropMatch) {
    const parts = cropMatch[1]!.split(",").map((n) => Math.min(99, Math.max(0, Number(n))));
    if (parts.every((n) => Number.isFinite(n))) {
      crop = parts as MdCrop;
      rest = (withoutWidth.slice(0, cropMatch.index) + withoutWidth.slice(cropMatch.index + cropMatch[0].length)).trimEnd();
    }
  }

  // The alignment is the alt's last word only: `a right answer` is text, and
  // so is `right answer` — a placement word stands alone at the end, where a
  // tool writes it.
  let align: MdAlign | undefined;
  const words = rest.split(/\s+/).filter(Boolean);
  const last = words[words.length - 1];
  if (last === "left" || last === "right" || last === "center") {
    align = last;
    words.pop();
  }
  const alt = words.join(" ");

  const width =
    widthMatch && Number(widthMatch[1]) > 0
      ? widthMatch[2]
        ? `${Math.min(Number(widthMatch[1]), 100)}%`
        : `${Number(widthMatch[1])}px`
      : undefined;

  return { alt, ...(crop ? { crop } : {}), ...(align ? { align } : {}), ...(width ? { width } : {}) };
}

/**
 * The alt text to write for a figure: its own text, its placement, and its
 * width, in the one spelling the renderer reads back.
 */
export function withMdImageAlt(
  alt: string,
  placement: { crop?: MdCrop | null; align?: MdAlign | null; width?: string | null },
): string {
  const words: string[] = [];
  if (alt.trim()) words.push(alt.trim());
  if (placement.align) words.push(placement.align);
  let out = words.join(" ");
  if (placement.crop) out += ` c=${placement.crop.join(",")}`;
  const width = placement.width;
  if (width) {
    const n = Number.parseInt(width, 10);
    if (Number.isFinite(n) && n > 0) {
      out += `|${width.endsWith("%") ? `${Math.min(n, 100)}%` : n}`;
    }
  }
  return out;
}
