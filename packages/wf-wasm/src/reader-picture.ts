/**
 * Placed pictures (Rust `reader::picture`), re-exported from index.ts. `picturePath`
 * is exported by ./reader-mark-actions.ts. The picture types come from ./bindings.ts.
 */
import {
  pictureMeta as rawPictureMeta,
  pictureComment as rawPictureComment,
  pagePictures as rawPagePictures,
  pictureRect as rawPictureRect,
  draftPicture as rawDraftPicture,
} from "../pkg/wf_wasm.js";
import type { NewReaderAnnotation, ReaderAnnotation } from "@weaveforge/core";
import type {
  FigureGeometry,
  PagePicture,
  PictureDraftInput,
  PictureMeta,
} from "./bindings.js";

/** The picture's stored file, crop and stacking order, or null if the mark is not a picture. */
export function pictureMeta(kind: string, comment?: string | null): PictureMeta | null {
  return rawPictureMeta(kind, comment ?? undefined) as PictureMeta | null;
}

/** The comment text that stores a picture's crop and stacking order. */
export function pictureComment(meta: PictureMeta): string {
  return rawPictureComment(meta);
}

/** The placed pictures on a page, figure-ready and in paint order. */
export function pagePictures(annotations: readonly ReaderAnnotation[], pageHeight: number): PagePicture[] {
  return rawPagePictures(annotations, pageHeight) as PagePicture[];
}

/** A figure's `[x1, y1, x2, y2]` rect in PDF user space. */
export function pictureRect(figure: FigureGeometry, pageHeight: number): [number, number, number, number] {
  return rawPictureRect(figure, pageHeight) as [number, number, number, number];
}

/** A new picture mark sized to half the page at the picture's own aspect. */
export function draftPicture(input: PictureDraftInput): NewReaderAnnotation {
  return rawDraftPicture(input) as NewReaderAnnotation;
}
