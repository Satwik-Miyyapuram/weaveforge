import { materializeBlobImages, type MaterializedBody } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

/** Prefix for report section images: `![](reportimg:userId/sectionId/file.webp)`. */
export const REPORT_IMAGE_PREFIX = "reportimg:";

export function reportImageMarkdown(path: string, alt = "image"): string {
  return readyCore().markdownImage(`${REPORT_IMAGE_PREFIX}${path}`, alt);
}

/** Collect unique report image paths referenced in section notes. */
export function reportImagePathsInBody(body: string): string[] {
  return readyCore().imagePathsInBody(body, REPORT_IMAGE_PREFIX);
}

/** Upload pasted `blob:` image refs and rewrite them to reportimg: paths before save. */
export function materializeReportBlobImages(
  body: string,
  sectionId: string,
  upload: (sectionId: string, blob: Blob, ext: string) => Promise<string>,
): Promise<MaterializedBody> {
  return materializeBlobImages(body, sectionId, upload, REPORT_IMAGE_PREFIX, (text: string) =>
    readyCore().normalizeMarkdownImageSyntax(text),
  );
}
