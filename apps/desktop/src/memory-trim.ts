import { app, type BrowserWindow } from "electron";

/** How long a blurred window sits before its working set is trimmed. */
const IDLE_TRIM_MS = 180_000;
let idleTrim: NodeJS.Timeout | null = null;

/**
 * Hand inactive pages back to Windows. `process.trimWorkingSet` is Electron's
 * own binding over `EmptyWorkingSet`; it drops the cached pages the OS would
 * otherwise keep resident for lack of pressure, and the next focus faults them
 * back in without a visible stall. A no-op elsewhere.
 */
function trimProcessMemory(): void {
  if (process.platform !== "win32") return;
  const trim = (process as unknown as { trimWorkingSet?: () => void })
    .trimWorkingSet;
  try {
    trim?.();
  } catch {
    // Not fatal: the working set is merely left as it was.
  }
}

export function registerMemoryTrimming(window: BrowserWindow): void {
  window.on("minimize", trimProcessMemory);
  window.on("blur", () => {
    if (idleTrim) clearTimeout(idleTrim);
    idleTrim = setTimeout(trimProcessMemory, IDLE_TRIM_MS);
  });
  window.on("focus", () => {
    if (idleTrim) clearTimeout(idleTrim);
    idleTrim = null;
  });
}

/** Chromium switches that bound memory; call before `whenReady`. */
export function applyMemorySwitches(): void {
  /*
   * Memory (docs/internal/design/memory-optimization.md, tiers 1 and 2).
   *
   * Every switch must be appended before `whenReady`; Chromium reads them when
   * it starts its subprocesses. The V8 cap applies to every renderer and worker
   * isolate. 512 MB rather than the note's 256: the encoder worker's JS heap
   * and a large vault's search index both live under it, and an isolate that
   * hits the cap is killed outright, which costs far more than the difference.
   */
  app.commandLine.appendSwitch("js-flags", "--max-old-space-size=512");
  /*
   * Not `--optimize-for-size`. It was here with the heap cap, and it cost the
   * encoder worker most of its speed: the ONNX runtime is WebAssembly, and a
   * forward pass measured ~2 s per passage in this shell against 0.12 s natively
   * — a corpus that should embed in minutes took the better part of an hour.
   *
   * And SharedArrayBuffer, which the app's origin is not cross-origin isolated
   * enough to get on its own: with it the runtime splits each pass across
   * threads (see `embedding-worker.ts`). Nothing else here posts shared memory.
   */
  app.commandLine.appendSwitch("enable-features", "SharedArrayBuffer");
  app.commandLine.appendSwitch("disable-speech-api");
  app.commandLine.appendSwitch("disable-print-preview");
  app.commandLine.appendSwitch(
    "disable-features",
    [
      "Translate",
      "AutofillServerCommunication",
      "CalculateNativeWinOcclusion",
      "MediaRouter",
      "OptimizationHints",
    ].join(","),
  );
  app.commandLine.appendSwitch("force-color-profile", "srgb");
  app.commandLine.appendSwitch("max-active-webgl-contexts", "4");
}
