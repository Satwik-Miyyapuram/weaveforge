import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { AppContainer } from "@/container/facades";
import { warmScreen } from "@/lib/cache/prefetch-screen";

/**
 * Hovering a nav item warms that screen's data. The warm-up is a guess, so a
 * failed one must stay quiet: the screen reports its own failure when it opens.
 *
 * It used to start every load with `void`, so a rejected load had no handler.
 * During a short connection drop each hover over the sidebar became an
 * unhandled rejection, and the app reported "Failed to fetch" for a screen the
 * reader never opened.
 */

const offline = () => Promise.reject(new TypeError("Failed to fetch"));
const loader = { loadScreenData: offline };
const container = {
  papers: { ...loader, listPapers: offline },
  vault: loader,
  graph: loader,
  readingLists: loader,
  experiments: loader,
  plan: loader,
  logbook: { loadEntries: offline },
  report: loader,
  sharing: { loadSharedWithMeScreen: offline },
} as unknown as AppContainer;

const screens = [
  "papers", "vault", "graph", "lists", "experiments", "plan", "logbook", "report", "report-overleaf", "shared-with-me",
] as const;

test("a failed warm-up reaches the caller instead of escaping unhandled", async () => {
  const escaped: unknown[] = [];
  const onEscape = (reason: unknown) => escaped.push(reason);
  process.on("unhandledRejection", onEscape);
  try {
    for (const screen of screens) {
      await assert.rejects(warmScreen(container, screen), /Failed to fetch/, screen);
    }
    // Unhandled rejections are reported after the microtask queue drains.
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    process.off("unhandledRejection", onEscape);
  }
  assert.deepEqual(escaped, []);
});

test("the hover handler swallows a failed warm-up", () => {
  const source = readFileSync(fileURLToPath(new URL("../prefetch-screen.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /void c\./, "no load is started without a handler");
  assert.match(source, /warmScreen\(c, screen\)\)\s*\.catch\(/);
});
