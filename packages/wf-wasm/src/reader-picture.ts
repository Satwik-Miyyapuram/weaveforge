/**
 * Placed pictures (Rust `reader::picture`), re-exported from index.ts. `picturePath`
 * is exported by ./reader-mark-actions.ts. The picture types come from ./bindings.ts.
 */
import { pagePictures as rawPagePictures, draftPicture as rawDraftPicture } from "../pkg/wf_wasm.js";
import type { NewReaderAnnotation, ReaderAnnotation } from "@weaveforge/core";
import type { PagePicture, PictureDraftInput } from "./bindings.js";

export {
  pictureComment,
  pictureMeta,
  pictureRect,
} from "../pkg/wf_wasm.js";

/** The placed pictures on a page, figure-ready and in paint order. */
export function pagePictures(annotations: readonly ReaderAnnotation[], pageHeight: number): PagePicture[] {
  return rawPagePictures(annotations, pageHeight) as PagePicture[];
}

/** A new picture mark sized to half the page at the picture's own aspect. */
export function draftPicture(input: PictureDraftInput): NewReaderAnnotation {
  return rawDraftPicture(input) as NewReaderAnnotation;
}
