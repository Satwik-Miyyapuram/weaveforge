import {
  imagePathsInBody,
  markdownImage,
  materializeBlobImages,
  normalizeMarkdownImageSyntax,
} from "@weaveforge/core";

/** Prefix embedded paper images use in markdown: `![](paperimg:userId/paperId/file.webp)`. */
export const PAPER_IMAGE_PREFIX = "paperimg:";

export function paperImageMarkdown(path: string, alt = "image"): string {
  return markdownImage(`${PAPER_IMAGE_PREFIX}${path}`, alt);
}

/** Collect unique paper image paths referenced in a note body. */
export function paperImagePathsInBody(body: string): string[] {
  return imagePathsInBody(body, PAPER_IMAGE_PREFIX, normalizeMarkdownImageSyntax);
}

/** Upload any pasted `blob:` image refs and rewrite them to paperimg: paths before save. */
export function materializePaperBlobImages(
  body: string,
  paperId: string,
  upload: (paperId: string, blob: Blob, ext: string) => Promise<string>,
): Promise<string> {
  return materializeBlobImages(body, paperId, upload, PAPER_IMAGE_PREFIX, normalizeMarkdownImageSyntax);
}
