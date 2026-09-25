/**
 * The Windows Ink adapter: the helper's per-word evidence becomes a scored
 * line, and no engine line ever comes back as `1`, the mark of a correction.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { DesktopBridge, DesktopInkResult } from "@/lib/desktop/desktop-bridge";

import { createDesktopInkRecogniser } from "../application/recognisers";

const bridge = (result: DesktopInkResult) =>
  ({ inkRecognise: async () => result }) as unknown as DesktopBridge;

const hints = { vocabulary: ["softmax"], lang: "en-US" };

test("per-word readings are decoded into the line's text and score", async () => {
  const recogniser = createDesktopInkRecogniser(() =>
    bridge({
      engine: "windows-ink@1",
      ms: 3,
      lines: [
        {
          text: "the softmox",
          confidence: 1,
          words: [
            { candidates: ["the"], known: [true] },
            { candidates: ["softmox", "softmax"], known: [false, false] },
          ],
        },
      ],
    }),
  );
  const [line] = await recognisers(recogniser);
  assert.equal(line?.text, "the softmax");
  assert.ok(line!.conf < 1);
  assert.equal(line?.alternatives?.[0], "the softmox");
});

test("a line without words keeps its text and is capped under 1", async () => {
  const recogniser = createDesktopInkRecogniser(() =>
    bridge({ engine: "windows-ink@1", ms: 3, lines: [{ text: "hello", confidence: 1 }] }),
  );
  const [line] = await recognisers(recogniser);
  assert.equal(line?.text, "hello");
  assert.ok(line!.conf < 1);
});

function recognisers(recogniser: ReturnType<typeof createDesktopInkRecogniser>) {
  return recogniser.recognise([{ strokes: [], yBand: [0, 0] }], hints);
}
