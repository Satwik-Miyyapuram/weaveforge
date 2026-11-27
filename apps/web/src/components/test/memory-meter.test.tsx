/** Hidden memory meter behind `wf:memMeter` (0.9.8, 10b): flag, formatting, no markup by default. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MEMORY_METER_INTERVAL_MS, MemoryMeter, formatMemory, readMemoryMeter } from "../memory-meter";

test("the flag is on only for the exact value", () => {
  assert.equal(readMemoryMeter({ getItem: () => "on" }), true);
  assert.equal(readMemoryMeter({ getItem: () => "1" }), false);
  assert.equal(readMemoryMeter({ getItem: () => null }), false);
  // undefined falls back to globalThis.localStorage, which is undefined in node
  assert.equal(readMemoryMeter(undefined), false);
});

test("a storage that throws keeps it off", () => {
  assert.equal(
    readMemoryMeter({
      getItem: () => {
        throw new Error("blocked");
      },
    }),
    false,
  );
});

test("formatMemory shows megabytes with one decimal", () => {
  assert.equal(formatMemory({ heapBytes: 12.34 * 1048576, domNodes: 4567 }), "JS 12.3 MB · DOM 4567");
});

test("formatMemory says n/a without a heap reading", () => {
  assert.equal(formatMemory({ heapBytes: null, domNodes: 0 }), "JS n/a · DOM 0");
});

test("the meter adds no markup before its effect runs", () => {
  assert.equal(renderToStaticMarkup(<MemoryMeter />), "");
});

test("the meter samples every two seconds", () => {
  assert.equal(MEMORY_METER_INTERVAL_MS, 2000);
});
