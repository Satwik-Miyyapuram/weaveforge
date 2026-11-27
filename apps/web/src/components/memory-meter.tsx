"use client";

import { useEffect, useState } from "react";

/** One reading: JS heap in bytes (null where the browser hides it) and the element count. */
export interface MemorySample {
  heapBytes: number | null;
  domNodes: number;
}

/** Hidden Dev toggle: `localStorage["wf:memMeter"] = "on"`, then reload. Anything else, or no storage, keeps it off. */
export function readMemoryMeter(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): boolean {
  try {
    return storage?.getItem("wf:memMeter") === "on";
  } catch {
    return false;
  }
}

/** "JS 12.3 MB · DOM 4567", or "JS n/a · DOM 4567" without a heap reading. */
export function formatMemory(sample: MemorySample): string {
  const heap = sample.heapBytes === null ? "n/a" : `${(sample.heapBytes / 1048576).toFixed(1)} MB`;
  return `JS ${heap} · DOM ${sample.domNodes}`;
}

/** Reads the page now. `performance.memory` is Chromium-only (WebView2 has it). */
export function sampleMemory(): MemorySample {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return {
    heapBytes: typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null,
    domNodes: document.getElementsByTagName("*").length,
  };
}

export const MEMORY_METER_INTERVAL_MS = 2000;

/**
 * A corner readout of JS heap and DOM size for memory work (0.9.8, 10b).
 * Off unless the `wf:memMeter` flag is set; it never takes clicks. Mounted once, in the root layout.
 */
export function MemoryMeter() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!readMemoryMeter()) return;
    const tick = () => setText(formatMemory(sampleMemory()));
    tick();
    const id = setInterval(tick, MEMORY_METER_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
  if (text === null) return null;
  return (
    <output
      className="popover-panel"
      aria-hidden="true"
      data-memory-meter=""
      style={{ position: "fixed", left: 4, bottom: 4, zIndex: 2147483647, pointerEvents: "none", padding: "2px 6px", font: "10px/1.2 monospace" }}
    >
      {text}
    </output>
  );
}
