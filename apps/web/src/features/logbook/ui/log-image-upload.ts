import { getContainer } from "@/bootstrap";
import { editorImageUpload } from "@/lib/editor-image-upload";
import type { ImagePasteConfig } from "@/components/markdown/markdown-image-paste";
import { readyCore } from "@/lib/rust-core";
import { LOG_IMAGE_PREFIX } from "../lib/log-image-ref";

/** How a log editor stores a dropped or pasted image: under `folderId`, as `logimg:` (S-16). */
export function logImageUpload(folderId: string, onError: (message: string) => void): ImagePasteConfig {
  return editorImageUpload({
    store: (blob, ext) => getContainer().logbook.uploadImage(folderId, blob, ext),
    toMarkdown: (path, alt) => readyCore().markdownImage(`${LOG_IMAGE_PREFIX}${path}`, alt),
    onError,
  });
}
