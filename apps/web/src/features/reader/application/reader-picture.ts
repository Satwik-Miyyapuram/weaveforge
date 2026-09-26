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
  type NewReaderAnnotation,
  type ReaderAnnotation,
} from "@weaveforge/core";

const PICTURE = /^!\[picture\]\(([^()\s]+)\)$/;

/** The stored file behind a placed picture; null for every other mark. */
export function picturePath(annotation: Pick<ReaderAnnotation, "type" | "comment">): string | null {
  if (annotation.type !== "image") return null;
  return PICTURE.exec(annotation.comment?.trim() ?? "")?.[1] ?? null;
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
