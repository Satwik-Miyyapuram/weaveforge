import { readyCore } from "@/lib/rust-core";

/** Prefix for log entry images: `![](logimg:userId/entryId/file.webp)`. */
export const LOG_IMAGE_PREFIX = "logimg:";

export function logImageMarkdown(path: string, alt = "image"): string {
  return readyCore().markdownImage(`${LOG_IMAGE_PREFIX}${path}`, alt);
}

/** Unique log image paths an entry's body references. */
export function logImagePathsInBody(body: string): string[] {
  return readyCore().imagePathsInBody(body, LOG_IMAGE_PREFIX);
}
