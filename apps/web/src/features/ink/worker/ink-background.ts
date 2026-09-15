/// <reference lib="webworker" />

/**
 * Background compositing for the ink worker (§4.8).
 *
 * Extracted from `ink-worker.ts` so background installation stays apart
 * from the worker's message pump.
 */

import type { InkPageBuffer } from "../application/page-buffer";
import type { InkRenderer } from "../render/ink-renderer";

export interface InkBackgroundState {
  background: ImageBitmap | null;
  renderer: InkRenderer | null;
  buffer: InkPageBuffer;
}

/** Install a new background image onto the worker's state and renderer. */
export function setBackground(
  state: InkBackgroundState,
  image: ImageBitmap | null,
  index?: number,
): void {
  state.background?.close?.();
  state.background = image;
  state.renderer?.setBackground(image);
  // The image is the *rendering* of §4.8; the buffer carries the
  // attachment index the chunk header mirrors, so a later save — a
  // stroke drawn over the image, say — writes it back rather than
  // clearing it.
  if (typeof index === "number") {
    state.buffer.setBackgroundIndex(index);
  }
}
