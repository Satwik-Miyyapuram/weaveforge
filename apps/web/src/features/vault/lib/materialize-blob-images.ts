import {
  materializeBlobImages,
  VAULT_IMAGE_PREFIX,
  type MaterializedBody,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

/** Upload blob: image refs in markdown and replace them with vault: paths before save. */
export function materializeBlobImagesInBody(
  body: string,
  pageId: string,
  upload: (pageId: string, blob: Blob, ext: string) => Promise<string>,
): Promise<MaterializedBody> {
  return materializeBlobImages(body, pageId, upload, VAULT_IMAGE_PREFIX, (text: string) => readyCore().normalizeMarkdownImageSyntax(text));
}
