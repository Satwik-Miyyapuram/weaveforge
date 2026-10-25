/**
 * Free startup garbage in the renderer once the first page has loaded.
 *
 * Booting the web app leaves tens of MB of dead objects and decoded images
 * behind. `webFrame.clearCache()` (Electron) runs a GC, empties the WebCache and
 * sends a memory-pressure signal, so the renderer and GPU drop to their idle
 * size straight away instead of seconds later. It runs once: later navigations
 * are in-app and keep their cache.
 */
export function settleAfterLoad(
  target: Pick<EventTarget, "addEventListener">,
  clear: () => void,
  delayMs = 3000,
  later: (run: () => void, ms: number) => unknown = setTimeout,
): void {
  target.addEventListener("load", () => void later(clear, delayMs), { once: true });
}
