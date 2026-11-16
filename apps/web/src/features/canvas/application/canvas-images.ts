"use client";

import { getContainer } from "@/bootstrap";
import { editorImageUpload, prepare } from "@/lib/editor-image-upload";
import type { ImagePasteConfig } from "@/components/markdown/markdown-image-paste";
import { readyCore } from "@/lib/rust-core";

/** What a freeform page needs to take and show pictures, stored under one page. */
export interface CanvasImages {
  /** Pasting an image into a text box: the box's markdown references the stored picture. */
  paste: ImagePasteConfig;
  /** Stores a dropped or pasted picture as a page asset and returns its bare `vault:` path. */
  store: (file: File) => Promise<string>;
  /** The bytes of a stored picture, for drawing it. */
  fetch: (path: string) => Promise<Blob>;
}

/** The image side of a freeform page; assets go to the page's own folder in the vault. */
export function canvasImages(pageId: string): CanvasImages {
  const uploadAsset = (blob: Blob, ext: string) => getContainer().vault.uploadAsset(pageId, blob, ext);
  return {
    paste: editorImageUpload({ store: uploadAsset, toMarkdown: (path, alt) => readyCore().vaultImageMarkdown(path, alt) }),
    async store(file: File): Promise<string> {
      const { blob, ext } = await prepare(file);
      return uploadAsset(blob, ext);
    },
    fetch: (path) => getContainer().vault.fetchAssetBlob(path),
  };
}

/** A picture's natural size, read from its bytes. */
export async function loadNaturalSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}
