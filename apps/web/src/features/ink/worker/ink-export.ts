/// <reference lib="webworker" />

/**
 * Page export for the ink worker: render to PNG (or transparent PNG) via the
 * renderer, or reply with null if no renderer is active.
 *
 * Extracted from `ink-worker.ts` so the export path stays apart from the
 * worker's message pump.
 */

import type { InkWorkerEvent } from "../application/capture-protocol";
import type { InkRenderer } from "../render/ink-renderer";

/** Export a rendered page to PNG (or transparent PNG) via the renderer. */
export async function exportPage(
  renderer: InkRenderer | null,
  requestId: number,
  scale: number,
  transparent: boolean,
  post: (event: InkWorkerEvent) => void,
): Promise<void> {
  // A worker with no renderer still has to answer: the host is holding a
  // promise on this request id, and silence would hang the print and PNG
  // buttons for the rest of the session rather than reporting that there
  // is nothing to draw with.
  if (!renderer) {
    post({ type: "exported", requestId, png: null });
    return;
  }
  void renderer
    .capture(scale, transparent)
    .then((png) =>
      post({ type: "exported", requestId, png }),
    )
    .catch((error: unknown) => {
      // Said out loud rather than swallowed: a null PNG with no reason is
      // a button that does nothing.
      console.error(
        `ink: the export failed — ${error instanceof Error ? error.message : String(error)}`,
      );
      post({ type: "exported", requestId, png: null });
    });
}
