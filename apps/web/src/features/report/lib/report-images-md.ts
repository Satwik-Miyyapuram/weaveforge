import {
  imagePathsInBody,
  markdownImage,
  materializeBlobImages,
  normalizeMarkdownImageSyntax,
} from "@weaveforge/core";

/** Prefix for report section images: `![](reportimg:userId/sectionId/file.webp)`. */
export const REPORT_IMAGE_PREFIX = "reportimg:";

export function reportImageMarkdown(path: string, alt = "image"): string {
  return markdownImage(`${REPORT_IMAGE_PREFIX}${path}`, alt);
}

/** Collect unique report image paths referenced in section notes. */
export function reportImagePathsInBody(body: string): string[] {
  return imagePathsInBody(body, REPORT_IMAGE_PREFIX, normalizeMarkdownImageSyntax);
}

/** Upload pasted `blob:` image refs and rewrite them to reportimg: paths before save. */
export function materializeReportBlobImages(
  body: string,
  sectionId: string,
  upload: (sectionId: string, blob: Blob, ext: string) => Promise<string>,
): Promise<string> {
  return materializeBlobImages(body, sectionId, upload, REPORT_IMAGE_PREFIX, normalizeMarkdownImageSyntax);
}
