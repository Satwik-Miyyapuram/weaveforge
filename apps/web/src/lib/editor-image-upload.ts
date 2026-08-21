"use client";

import { imageAltFromFilename, imageExtensionForMime } from "@weaveforge/core";
import { compressImage } from "@/lib/image-compress";
import { formatError } from "@/lib/format-error";
import type { ImagePasteConfig } from "@/components/markdown/markdown-image-paste";

/**
 * The store-then-reference step every editing surface shares.
 *
 * Vault notes, report sections and paper notes each have their own bucket and
 * their own markdown prefix, and nothing else about accepting an image differs
 * between them — so the compression policy, the extension choice and the alt
 * text are decided once here rather than three times in three screens.
 */
export function editorImageUpload(options: {
  /** Store the blob and return the path the surface will reference it by. */
  store: (blob: Blob, ext: string) => Promise<string>;
  /** Wrap that path in this surface's markdown. */
  toMarkdown: (path: string, alt: string) => string;
  /** Where the screen shows its errors. */
  onError?: (message: string) => void;
}): ImagePasteConfig {
  return {
    onError: options.onError,
    async upload(file: File): Promise<string> {
      const { blob, ext } = await prepare(file);
      const path = await options.store(blob, ext);
      return options.toMarkdown(path, imageAltFromFilename(file.name));
    },
  };
}

/**
 * Downscales and re-encodes, with two exceptions.
 *
 * An animated GIF loses its animation on the way through a canvas — the
 * re-encode keeps the first frame and silently throws the rest away — so GIFs
 * are stored as they came. Anything the browser cannot decode is stored as it
 * came too, rather than refused: a format this browser does not know is still a
 * file the writer meant to attach, and the note keeps working.
 */
async function prepare(file: File): Promise<{ blob: Blob; ext: string }> {
  if (file.type === "image/gif") {
    return { blob: file, ext: "gif" };
  }
  try {
    return await compressImage(file);
  } catch (error) {
    // Kept, not thrown: a screenshot that this browser's canvas refuses is
    // still worth storing at full size.
    void formatError(error);
    return { blob: file, ext: imageExtensionForMime(file.type) };
  }
}
