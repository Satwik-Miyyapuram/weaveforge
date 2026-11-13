import {
  materializeBlobImages,
  type MaterializedBody,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

/** Upload blob: image refs in markdown and replace them with vault: paths before save. */
export function materializeBlobImagesInBody(
  body: string,
  pageId: string,
  upload: (pageId: string, blob: Blob, ext: string) => Promise<string>,
): Promise<MaterializedBody> {
  return materializeBlobImages(body, pageId, upload, readyCore().vaultImagePrefix(), (text: string) => readyCore().normalizeMarkdownImageSyntax(text));
}
