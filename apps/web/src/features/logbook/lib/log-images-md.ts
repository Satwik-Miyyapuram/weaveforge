import { imagePathsInBody, markdownImage, normalizeMarkdownImageSyntax } from "@weaveforge/core";

/** Prefix for log entry images: `![](logimg:userId/entryId/file.webp)`. */
export const LOG_IMAGE_PREFIX = "logimg:";

export function logImageMarkdown(path: string, alt = "image"): string {
  return markdownImage(`${LOG_IMAGE_PREFIX}${path}`, alt);
}

/** Unique log image paths an entry's body references. */
export function logImagePathsInBody(body: string): string[] {
  return imagePathsInBody(body, LOG_IMAGE_PREFIX, normalizeMarkdownImageSyntax);
}
