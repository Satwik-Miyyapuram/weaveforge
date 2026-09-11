/**
 * The ink note itself: frontmatter, the text layer in the body, the sidecar's
 * paths, and the pressure-aware packer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { simplifyPathIndices } from "../../src/reader/ink-stroke.js";
import { readFrontmatter, writeFrontmatter } from "../../src/workspace/frontmatter.js";
import {
  INK_A4_HEIGHT,
  INK_A4_WIDTH,
  INK_NOTE_MAX_PAGES,
  INK_NOTE_TYPE,
  INK_PAGE_STROKE_BUDGET,
  INK_SIDECAR_DIR,
  INK_STROKE_MAX_POINTS,
  blankInkPage,
  clampInkPageSize,
  defaultInkNoteMeta,
  inkChunkPath,
  inkPageMarker,
  inkPageOverBudget,
  inkSidecarDir,
  isInkChunkId,
  isInkNoteFrontmatter,
  isInkNoteId,
  joinInkTextLayer,
  makeInkStroke,
  newInkChunkId,
  packInkStroke,
  parseInkChunkPath,
  readInkNoteMeta,
  resolveInkPageOrder,
  splitInkTextLayer,
  writeInkNoteMeta,
} from "../../src/ink/ink-note.js";

/** Chunk ids that are valid by construction (26 Crockford characters). */
const CHUNK_A = "01JABC0DEF0GH0JK0MN0PQ0RST";
const CHUNK_B = "01JABC0DEF0GH0JK0MN0PQ0RSV";

test("ink metadata round-trips through the frontmatter the workspace writes", () => {
  const meta = {
    pages: 3,
    paper: "dotted" as const,
    pageOrder: [CHUNK_A, CHUNK_B],
    recognised: 0.94,
    engine: "windows-ink@1",
    hand: "left" as const,
  };
  const file = writeFrontmatter(
    {
      "weaveforge-id": "01JNOTE",
      "weaveforge-type": INK_NOTE_TYPE,
      title: "Supervisor meeting 11 Feb",
      ...writeInkNoteMeta(meta),
    },
    "Drop the β sweep.\n",
  );
  const { frontmatter, body } = readFrontmatter(file);
  assert.equal(isInkNoteFrontmatter(frontmatter), true);
  assert.deepEqual(readInkNoteMeta(frontmatter), meta);
  assert.equal(body, "Drop the β sweep.\n");
});

test("a note with no ink keys is a valid empty ink note: one blank page", () => {
  const { frontmatter } = readFrontmatter(
    writeFrontmatter({ "weaveforge-type": INK_NOTE_TYPE, title: "Untitled" }, ""),
  );
  const meta = readInkNoteMeta(frontmatter);
  assert.deepEqual(meta, defaultInkNoteMeta());
  assert.equal(meta.pages, 1);
  assert.deepEqual(meta.pageOrder, [], "the chunk list is empty until a page is written");
  assert.equal(meta.engine, null);
  assert.deepEqual(blankInkPage().strokes, []);
  assert.equal(blankInkPage().width, INK_A4_WIDTH);
  assert.equal(blankInkPage().height, INK_A4_HEIGHT);
});

test("nonsense in the ink keys is read as the default rather than trusted", () => {
  const { frontmatter } = readFrontmatter(
    [
      "---",
      "weaveforge-type: ink_page",
      "ink-pages: -4",
      "ink-paper: vellum",
      `ink-page-order: [${CHUNK_A}, not-a-ulid, ../../etc/passwd]`,
      "ink-recognised: 7",
      "ink-hand: ambidextrous",
      "---",
      "",
    ].join("\n"),
  );
  const meta = readInkNoteMeta(frontmatter);
  assert.equal(meta.pages, 1);
  assert.equal(meta.paper, "blank");
  assert.deepEqual(meta.pageOrder, [CHUNK_A], "only ids shaped like chunk ids survive");
  assert.equal(meta.recognised, 0);
  assert.equal(meta.hand, "right");
});

test("the page count is capped at the fifty pages a note may hold", () => {
  const { frontmatter } = readFrontmatter(
    ["---", "weaveforge-type: ink_page", `ink-pages: ${INK_NOTE_MAX_PAGES + 20}`, "---", ""].join("\n"),
  );
  assert.equal(readInkNoteMeta(frontmatter).pages, INK_NOTE_MAX_PAGES);
});

test("the text layer splits into pages on its markers and rejoins unchanged", () => {
  const body = [
    "Drop the β sweep for §3.2, see [[Graph-prior module]].",
    "",
    inkPageMarker(2),
    "",
    "![](vault:papers/kipf-2016/page-3.png)",
    "Compare against [[VGAE]] table 2.",
    "",
  ].join("\n");
  const pages = splitInkTextLayer(body);
  assert.equal(pages.length, 2);
  assert.equal(pages[0], "Drop the β sweep for §3.2, see [[Graph-prior module]].");
  assert.equal(pages[1], "![](vault:papers/kipf-2016/page-3.png)\nCompare against [[VGAE]] table 2.");
  assert.equal(splitInkTextLayer(joinInkTextLayer(pages)).length, 2);
  assert.deepEqual(splitInkTextLayer(joinInkTextLayer(pages)), pages);
});

test("a note with no recognised text at all is one empty page, not zero", () => {
  assert.deepEqual(splitInkTextLayer(""), [""]);
  assert.deepEqual(splitInkTextLayer("\n\n"), [""]);
  assert.equal(joinInkTextLayer([""]), "\n");
  assert.deepEqual(splitInkTextLayer(joinInkTextLayer(["", ""])), ["", ""]);
});

test("the sidecar lives under .ink/<note id>, keyed by id so a rename cannot orphan it", () => {
  assert.equal(inkSidecarDir("01JNOTE"), `${INK_SIDECAR_DIR}/01JNOTE`);
  const path = inkChunkPath("01JNOTE", CHUNK_A);
  assert.equal(path, `.ink/01JNOTE/${CHUNK_A}.inkb`);
  assert.deepEqual(parseInkChunkPath(path), { noteId: "01JNOTE", chunkId: CHUNK_A });
  assert.equal(parseInkChunkPath(".ink/01JNOTE/not-a-chunk.inkb"), null);
  assert.equal(parseInkChunkPath("notes/01JNOTE/x.inkb"), null);
  assert.equal(parseInkChunkPath(".ink/01JNOTE/x.inkb/extra"), null);
  assert.equal(parseInkChunkPath(""), null);
});

test("a path-shaped id is refused rather than woven into the folder", () => {
  assert.equal(isInkNoteId("01JNOTE"), true);
  assert.equal(isInkNoteId("../escape"), false);
  assert.equal(isInkNoteId("a/b"), false);
  assert.equal(isInkNoteId(""), false);
  assert.throws(() => inkSidecarDir("../escape"), /unusable note id/);
  assert.throws(() => inkChunkPath("01JNOTE", "../../etc/passwd"), /unusable chunk id/);
  assert.equal(parseInkChunkPath(".ink/../escape/01JABC0DEF0GH0JK0MN0PQ0RS.inkb"), null);
});

test("a chunk id is a ULID: twenty-six characters, sortable by creation", () => {
  const fixed = newInkChunkId({ now: 1_700_000_000_000, randomBytes: (target) => target.fill(7) });
  assert.equal(fixed.length, 26);
  assert.equal(isInkChunkId(fixed), true);
  assert.equal(newInkChunkId({ now: 1_700_000_000_000, randomBytes: (t) => t.fill(7) }), fixed);

  const later = newInkChunkId({ now: 1_700_000_001_000, randomBytes: (t) => t.fill(7) });
  assert.ok(later > fixed, "ids sort by the time they were made");
  assert.notEqual(
    newInkChunkId({ now: 1_700_000_000_000, randomBytes: (t) => t.fill(9) }),
    fixed,
    "and differ when the randomness does",
  );
  // The whole alphabet is Crockford base32, which excludes I, L, O and U.
  assert.equal(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(fixed), true);
});

test("page order: what the note declares first, then whatever else is on disk", () => {
  assert.deepEqual(resolveInkPageOrder([CHUNK_B, CHUNK_A], [CHUNK_A, CHUNK_B]), [CHUNK_B, CHUNK_A]);
  // A chunk that appeared without being recorded is not hidden.
  assert.deepEqual(resolveInkPageOrder([CHUNK_B], [CHUNK_A, CHUNK_B]), [CHUNK_B, CHUNK_A]);
  // A chunk that vanished does not make the note unopenable.
  assert.deepEqual(resolveInkPageOrder([CHUNK_B, CHUNK_A], [CHUNK_B]), [CHUNK_B]);
  // Files that are not chunks are ignored rather than ordered.
  assert.deepEqual(resolveInkPageOrder([], ["notes.md", CHUNK_A]), [CHUNK_A]);
  assert.equal(resolveInkPageOrder([], Array.from({ length: 60 }, () => CHUNK_A)).length, INK_NOTE_MAX_PAGES);
});

test("a page over the stroke budget says so rather than refusing to open", () => {
  const strokes = Array.from({ length: INK_PAGE_STROKE_BUDGET + 1 }, () =>
    makeInkStroke({ points: [0, 0, 10, 10] }),
  );
  assert.equal(inkPageOverBudget(blankInkPage()), false);
  assert.equal(inkPageOverBudget({ ...blankInkPage(), strokes }), true);
});

test("packing a stroke simplifies it and keeps its endpoints", () => {
  const coords: number[] = [];
  for (let i = 0; i < 200; i += 1) coords.push(i * 4, 400 + Math.sin(i / 6) * 12);
  const packed = packInkStroke(coords);
  assert.ok(packed.points.length >= 4);
  assert.ok(packed.points.length < coords.length / 2, "the curve no longer needs every sample");
  assert.deepEqual(packed.points.slice(0, 2), [coords[0], Math.round(coords[1]!)], "the start is kept");
  assert.deepEqual(
    packed.points.slice(-2),
    [coords[coords.length - 2], Math.round(coords[coords.length - 1]!)],
    "and so is the end",
  );
  assert.equal(packed.pressures.length, packed.points.length / 2);
  for (const value of packed.points) assert.equal(Number.isInteger(value), true, "0.1 mm is whole");
});

test("a stroke with nothing drawable in it packs to nothing", () => {
  assert.deepEqual(packInkStroke([]), { points: [], pressures: [] });
  assert.deepEqual(packInkStroke([10, 10]), { points: [], pressures: [] });
  assert.deepEqual(packInkStroke([Number.NaN, 1, 2, 3]), { points: [], pressures: [] });
});

test("packing never exceeds the stroke point cap, and keeps the true end", () => {
  const coords: number[] = [];
  for (let i = 0; i < 4_000; i += 1) {
    // A zig-zag: no tolerance removes these without losing the shape.
    coords.push(i, i % 2 === 0 ? 0 : 40);
  }
  const packed = packInkStroke(coords);
  assert.ok(packed.points.length / 2 <= INK_STROKE_MAX_POINTS);
  assert.deepEqual(packed.points.slice(-2), coords.slice(-2));
});

test("pressure that the centreline pass would have dropped is put back (§4.4)", () => {
  // A straight line: Ramer–Douglas–Peucker keeps the two endpoints and nothing
  // else, so every interior point here survives only for its pressure.
  const coords = [0, 0, 10, 0, 20, 0, 30, 0, 40, 0];
  assert.deepEqual(simplifyPathIndices(coords, 1.2), [0, 4], "the centreline needs only the ends");

  // A press that rises and falls is a taper, and losing it loses the stroke's
  // look while its centreline stays correct.
  const tapered = packInkStroke(coords, [0, 190, 220, 190, 0]);
  assert.ok(tapered.points.length / 2 > 2, "the taper kept points the centreline did not");
  assert.deepEqual(tapered.pressures.slice(0, 1), [0]);
  assert.deepEqual(tapered.pressures.slice(-1), [0]);
  assert.ok(Math.max(...tapered.pressures) > 150, "and the press is still in the data");
});

test("pressure that follows the centreline adds no points at all", () => {
  const coords = [0, 0, 10, 0, 20, 0, 30, 0, 40, 0];
  const linear = packInkStroke(coords, [0, 64, 128, 191, 255]);
  assert.equal(linear.points.length / 2, 2, "a linear ramp is implied by its endpoints");
  assert.deepEqual(linear.pressures, [0, 255]);
});

test("pressure of the wrong length is ignored rather than misaligned", () => {
  const coords = [0, 0, 10, 0, 20, 0, 30, 0, 40, 0];
  const packed = packInkStroke(coords, [128, 128]);
  assert.equal(packed.points.length / 2, 2);
  assert.deepEqual(packed.pressures, [0, 0], "a point with no pressure sample stores none");
});

test("a page size that could not fit an Int16 coordinate is clamped", () => {
  assert.deepEqual(clampInkPageSize(0, 0), { width: INK_A4_WIDTH, height: INK_A4_HEIGHT });
  assert.deepEqual(clampInkPageSize(Number.NaN, 12), { width: INK_A4_WIDTH, height: 12 });
  assert.deepEqual(clampInkPageSize(100_000, 100_000), { width: 32767, height: 32767 });
  assert.deepEqual(clampInkPageSize(2100.4, 2970.6), { width: 2100, height: 2971 });
});
