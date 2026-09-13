/**
 * An image on a page (§4.8): the text layer names it, the chunk header mirrors
 * it, and neither is allowed to disturb the strokes.
 *
 * The two halves of that fact live in different files — the text layer is
 * core's, the chunk is the page raster's — so what is checked here is that
 * they agree, and that the agreement survives the codec the sidecar is stored
 * with. The host's own wiring (which page a drop lands on, the clipboard, the
 * bar's replace-or-new-page question) is React, and is on the manual list.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INK_A4_HEIGHT,
  INK_A4_WIDTH,
  blankInkPage,
  decodeInkChunk,
  encodeInkChunk,
  inkAttachmentIndex,
  joinInkTextLayer,
  makeInkStroke,
  pageFromChunk,
  readInkChunkHeader,
  withInkPageBackground,
  type InkPage,
} from "@weaveforge/core";

import { inkChunkCodec } from "../application/ink-chunk-codec";
import { InkPageBuffer } from "../application/page-buffer";
import {
  imageFileFromClipboard,
  pageChunkWithBackground,
} from "../application/page-background";

/** The codec the app stores with, as the host and the worker both ask for it. */
const codec = inkChunkCodec("deflate-raw") ?? undefined;

/** A page with one stroke and one recognised line, so a re-pack has something to lose. */
function pageWithInk(): InkPage {
  return {
    ...blankInkPage("ruled"),
    strokes: [
      makeInkStroke({
        points: [100, 100, 140, 160, 180, 120],
        pressures: [10, 20, 30],
        width: 5,
        tool: "pen",
        colour: "accent",
        lineIndex: 0,
      }),
    ],
    lines: [
      {
        strokeStart: 0,
        strokeCount: 1,
        yMin: 100,
        yMax: 160,
        text: "hello",
        confidence: 1,
      },
    ],
  };
}

/* -------------------------------------------------------------------------
 * The text layer
 * ---------------------------------------------------------------------- */

test("setting a page's image puts the background line first, and only once", () => {
  const set = withInkPageBackground("hello\n\nworld", "a/b.png");
  assert.equal(set, "![page background](vault:a/b.png)\n\nhello\n\nworld");

  // Replacing is the same operation: there is never a second line.
  const replaced = withInkPageBackground(set, "c/d.png");
  assert.equal(replaced, "![page background](vault:c/d.png)\n\nhello\n\nworld");
  assert.equal(replaced.split("![page background]").length, 2);
});

test("clearing a page's image leaves the recognised text exactly as it was", () => {
  const cleared = withInkPageBackground(
    withInkPageBackground("line one\nline two", "a/b.png"),
    null,
  );
  assert.equal(cleared, "line one\nline two");
  assert.equal(withInkPageBackground("", null), "");
});

test("the attachment index counts the page's place among the note's image refs", () => {
  const pages = [
    withInkPageBackground("first", "a.png"),
    "middle",
    withInkPageBackground("third", "b.png"),
  ];
  const body = joinInkTextLayer(pages);
  assert.equal(inkAttachmentIndex(body, "a.png"), 1);
  assert.equal(inkAttachmentIndex(body, "b.png"), 2);
  assert.equal(inkAttachmentIndex(body, null), 0);

  // A page inserted ahead moves them, which is why the index is counted from
  // the body rather than kept beside the page.
  const moved = joinInkTextLayer([withInkPageBackground("new", "c.png"), ...pages]);
  assert.equal(inkAttachmentIndex(moved, "a.png"), 2);
  assert.equal(inkAttachmentIndex(moved, "c.png"), 1);
});

/* -------------------------------------------------------------------------
 * The chunk header
 * ---------------------------------------------------------------------- */

test("a page's chunk takes the background index and keeps its strokes", async () => {
  const page = pageWithInk();
  const stored = await encodeInkChunk(page, codec);

  const rewritten = await pageChunkWithBackground(stored, {
    background: 2,
    paper: "ruled",
    codec,
  });
  const model = pageFromChunk(await decodeInkChunk(rewritten, codec));

  assert.equal(model.background, 2);
  assert.equal(model.paper, "ruled");
  assert.deepEqual(
    model.strokes.map((stroke) => [...stroke.points]),
    page.strokes.map((stroke) => [...stroke.points]),
  );
  assert.equal(model.strokes[0]?.colour, "accent");
  assert.equal(model.strokes[0]?.width, 5);
  assert.equal(model.lines[0]?.text, "hello");
});

test("clearing the image writes zero and still keeps the strokes", async () => {
  const stored = await pageChunkWithBackground(await encodeInkChunk(pageWithInk(), codec), {
    background: 7,
    paper: "ruled",
    codec,
  });
  const cleared = await pageChunkWithBackground(stored, {
    background: 0,
    paper: "ruled",
    codec,
  });
  const model = pageFromChunk(await decodeInkChunk(cleared, codec));
  assert.equal(model.background, 0);
  assert.equal(model.strokes.length, 1);
});

test("a page with no chunk yet is a blank sheet at the size it is given", async () => {
  const bytes = await pageChunkWithBackground(null, {
    background: 1,
    paper: "blank",
    size: { width: 2100, height: 1400 },
  });
  const model = pageFromChunk(await decodeInkChunk(bytes));
  assert.equal(model.background, 1);
  assert.equal(model.width, 2100);
  assert.equal(model.height, 1400);
  assert.equal(model.strokes.length, 0);

  // No size named is A4, which is what every ink page is.
  const a4 = pageFromChunk(await decodeInkChunk(await pageChunkWithBackground(null, {
    background: 0,
    paper: "blank",
  })));
  assert.equal(a4.width, INK_A4_WIDTH);
  assert.equal(a4.height, INK_A4_HEIGHT);
});

test("the host's chunk is compressed and one the worker can read back", async () => {
  // Over the 64 KiB raw threshold, and written as a pen writes: many strokes of
  // a few hundred points, each a nearly straight run, so the delta chain has
  // something to compress. Below the threshold a body is stored raw on purpose
  // (§4.3), which is what the small pages elsewhere in this suite exercise.
  const page: InkPage = {
    ...blankInkPage("blank"),
    strokes: Array.from({ length: 40 }, (_unused, stroke) =>
      makeInkStroke({
        points: Array.from({ length: 350 }, (_point, i) => [
          100 + stroke * 40 + (i % 30),
          100 + i * 2,
        ]).flat(),
        pressures: [],
      }),
    ),
  };
  const points = page.strokes[0]!.points;

  const bytes = await pageChunkWithBackground(await encodeInkChunk(page, codec), {
    background: 3,
    paper: "blank",
    codec,
  });
  assert.equal(readInkChunkHeader(bytes).compressed, true);

  const model = pageFromChunk(await decodeInkChunk(bytes, codec));
  assert.equal(model.strokes.length, 40);
  assert.deepEqual([...model.strokes[0]!.points], [...points]);
  assert.equal(model.background, 3);

  // Which is the whole reason the codec is shared: a reader that cannot
  // inflate cannot read what the writer produced.
  await assert.rejects(() => decodeInkChunk(bytes));
});

/* -------------------------------------------------------------------------
 * The worker's copy of the same page
 * ---------------------------------------------------------------------- */

test("a page's buffer carries its attachment index into the next save", () => {
  const buffer = new InkPageBuffer({ ...blankInkPage("blank"), background: 3 });
  assert.equal(buffer.toPage().background, 3);

  // What the host's set-background does to the page the worker holds, so a
  // stroke drawn over a new image does not save the page with no image.
  buffer.setBackgroundIndex(2);
  assert.equal(buffer.toPage().background, 2);

  // The chunk header holds a byte for it (§4.3).
  buffer.setBackgroundIndex(999);
  assert.equal(buffer.toPage().background, 255);
  buffer.setBackgroundIndex(Number.NaN);
  assert.equal(buffer.toPage().background, 0);
});

/* -------------------------------------------------------------------------
 * The clipboard
 * ---------------------------------------------------------------------- */

test("a pasted screenshot is the image item; a pasted string is not", () => {
  const png = new File([new Uint8Array([1, 2, 3])], "shot.png", {
    type: "image/png",
  });
  const plain = { kind: "string", type: "text/plain", getAsFile: () => null };

  assert.equal(
    imageFileFromClipboard({
      items: [plain, { kind: "file", type: "image/png", getAsFile: () => png }],
    }),
    png,
  );
  assert.equal(imageFileFromClipboard({ items: [plain] }), null);
  assert.equal(imageFileFromClipboard({ items: [] }), null);
  assert.equal(imageFileFromClipboard(null), null);

  // An image item the platform will not hand a file over for is not one either.
  assert.equal(
    imageFileFromClipboard({
      items: [{ kind: "file", type: "image/png", getAsFile: () => null }],
    }),
    null,
  );
  // And a file that is not an image — a PDF dropped on the clipboard — is
  // left for the drop handler, which knows about PDFs.
  assert.equal(
    imageFileFromClipboard({
      items: [
        {
          kind: "file",
          type: "application/pdf",
          getAsFile: () => new File([], "a.pdf", { type: "application/pdf" }),
        },
      ],
    }),
    null,
  );
});
