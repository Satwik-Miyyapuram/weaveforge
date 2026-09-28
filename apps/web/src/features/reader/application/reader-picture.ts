/**
 * A picture placed on a PDF page from the ink bar's Insert menu.
 *
 * It is an ordinary "image" annotation — the Clip tool's type, a rectangle on
 * the page — whose comment names the stored file. Keeping it in the comment
 * means it syncs, undoes and deletes as every other mark does, and a clip (whose
 * comment is the reader's own words) is never mistaken for one.
 */

import {
  buildAnnotationSortIndex,
  parseFigureCrop,
  type FigureGeometry,
  type NewReaderAnnotation,
  type ReaderAnnotation,
} from "@weaveforge/core";

/**
 * `![picture](path)`, with the placement the rectangle cannot hold after the
 * alt text: `c=l,t,r,b` is the crop (the ink note's figure token, percentages
 * of the image's own box) and `z=n` the stacking order among the page's
 * pictures. A picture written before either existed still reads.
 */
const PICTURE = /^!\[picture((?:\s+[a-z]=[^\s\]]+)*)\]\(([^()\s]+)\)$/;
const PICTURE_TOKEN = /\s([a-z])=([^\s\]]+)/g;

/** What a picture's comment says about it. */
export interface PictureMeta {
  path: string;
  /** Crop insets, `[left, top, right, bottom]` in percent; absent is the whole image. */
  crop?: [number, number, number, number];
  /** Paint order among the page's pictures: higher is on top. */
  z: number;
}

/** A picture's comment read back; null for every other mark. */
export function pictureMeta(
  annotation: Pick<ReaderAnnotation, "type" | "comment">,
): PictureMeta | null {
  if (annotation.type !== "image") return null;
  const match = PICTURE.exec(annotation.comment?.trim() ?? "");
  if (!match) return null;
  const meta: PictureMeta = { path: match[2]!, z: 0 };
  for (const [, key, value] of (match[1] ?? "").matchAll(PICTURE_TOKEN)) {
    if (key === "z") {
      const z = Number(value);
      if (Number.isFinite(z)) meta.z = z;
    } else if (key === "c") {
      const crop = parseFigureCrop(value ?? "");
      if (crop) meta.crop = crop;
    }
  }
  return meta;
}

/** The comment that says `meta`: the inverse of `pictureMeta`. */
export function pictureComment(meta: PictureMeta): string {
  const tokens: string[] = [];
  if (meta.crop && meta.crop.some((n) => n > 0)) tokens.push(`c=${meta.crop.join(",")}`);
  if (meta.z !== 0) tokens.push(`z=${meta.z}`);
  return `![picture${tokens.map((t) => ` ${t}`).join("")}](${meta.path})`;
}

/** The stored file behind a placed picture; null for every other mark. */
export function picturePath(annotation: Pick<ReaderAnnotation, "type" | "comment">): string | null {
  return pictureMeta(annotation)?.path ?? null;
}

/** One page's picture, as the ink note's figure renderer takes it. */
export interface PagePicture {
  id: string;
  /** In PDF points from the page's top-left: the rectangle, turned y-down. */
  figure: FigureGeometry;
  z: number;
}

/**
 * A page's pictures in paint order, as figures: PDF rectangles are y-up from
 * the page's foot, figures are y-down from its head, so `y` is the page's
 * height less the rectangle's top.
 */
export function pagePictures(
  annotations: readonly ReaderAnnotation[],
  pageHeight: number,
): PagePicture[] {
  const out: PagePicture[] = [];
  for (const annotation of annotations) {
    const meta = pictureMeta(annotation);
    const rect = annotation.anchor.zoteroPosition?.rects?.[0];
    if (!meta || !rect || rect.length < 4) continue;
    const [x1, y1, x2, y2] = rect as [number, number, number, number];
    const figure: FigureGeometry = {
      path: meta.path,
      x: Math.min(x1, x2),
      y: pageHeight - Math.max(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    };
    if (meta.crop) figure.crop = meta.crop;
    out.push({ id: annotation.id, figure, z: meta.z });
  }
  // Array sort is stable: pictures with one z keep the order they were placed in.
  return out.sort((a, b) => a.z - b.z);
}

/** A figure's box back as the PDF rectangle it came from. */
export function pictureRect(
  figure: Pick<FigureGeometry, "x" | "y" | "w" | "h">,
  pageHeight: number,
): [number, number, number, number] {
  return [figure.x, pageHeight - figure.y - figure.h, figure.x + figure.w, pageHeight - figure.y];
}

/**
 * A picture laid in the middle of a page, half the page wide, at its own
 * aspect ratio (capped so a tall one still fits the page).
 */
export function draftPicture(input: {
  path: string;
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  /** The picture's width over its height. */
  aspect: number;
}): NewReaderAnnotation {
  const { pageWidth, pageHeight } = input;
  const aspect = input.aspect > 0 && Number.isFinite(input.aspect) ? input.aspect : 4 / 3;
  let width = pageWidth * 0.5;
  let height = width / aspect;
  if (height > pageHeight * 0.8) {
    height = pageHeight * 0.8;
    width = height * aspect;
  }
  const x1 = (pageWidth - width) / 2;
  const y1 = (pageHeight - height) / 2;
  return {
    type: "image",
    color: "transparent",
    text: "",
    comment: `![picture](${input.path})`,
    pageIndex: input.pageIndex,
    anchor: {
      zoteroPosition: { pageIndex: input.pageIndex, rects: [[x1, y1, x1 + width, y1 + height]] },
    },
    sortIndex: buildAnnotationSortIndex(input.pageIndex, 0, pageHeight - (y1 + height)),
  };
}
