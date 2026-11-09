/**
 * The ink note itself: frontmatter, the text layer in the body, the sidecar's
 * paths, and the pressure-aware packer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";


import { rust } from "../../src/shared/rust.js";
import { INK_A4_HEIGHT, INK_A4_WIDTH, INK_NOTE_MAX_PAGES, INK_NOTE_TYPE, INK_PAGE_STROKE_BUDGET, INK_SIDECAR_DIR, INK_STROKE_MAX_POINTS } from "../../src/ink/ink-note.js";
import { rust } from "../../src/shared/rust.js";

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
  const file = rust().writeFrontmatter(
    {
      "weaveforge-id": "01JNOTE",
      "weaveforge-type": INK_NOTE_TYPE,
      title: "Supervisor meeting 11 Feb",
      ...rust().writeInkNoteMeta(meta),
    },
    "Drop the β sweep.\n",
  );
  const { frontmatter, body } = rust().readFrontmatter(file);
  assert.equal(rust().isInkNoteFrontmatter(frontmatter), true);
  assert.deepEqual(rust().readInkNoteMeta(frontmatter), meta);
  assert.equal(body, "Drop the β sweep.\n");
});

test("a note with no ink keys is a valid empty ink note: one blank page", () => {
  const { frontmatter } = rust().readFrontmatter(
    rust().writeFrontmatter({ "weaveforge-type": INK_NOTE_TYPE, title: "Untitled" }, ""),
  );
  const meta = rust().readInkNoteMeta(frontmatter);
  assert.deepEqual(meta, rust().defaultInkNoteMeta());
  assert.equal(meta.pages, 1);
  assert.deepEqual(meta.pageOrder, [], "the chunk list is empty until a page is written");
  assert.equal(meta.engine, null);
  assert.deepEqual(rust().blankInkPage().strokes, []);
  assert.equal(rust().blankInkPage().width, INK_A4_WIDTH);
  assert.equal(rust().blankInkPage().height, INK_A4_HEIGHT);
});

test("nonsense in the ink keys is read as the default rather than trusted", () => {
  const { frontmatter } = rust().readFrontmatter(
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
  const meta = rust().readInkNoteMeta(frontmatter);
  assert.equal(meta.pages, 1);
  assert.equal(meta.paper, "blank");
  assert.deepEqual(meta.pageOrder, [CHUNK_A], "only ids shaped like chunk ids survive");
  assert.equal(meta.recognised, 0);
  assert.equal(meta.hand, "right");
});

test("the page count is capped at the fifty pages a note may hold", () => {
  const { frontmatter } = rust().readFrontmatter(
    ["---", "weaveforge-type: ink_page", `ink-pages: ${INK_NOTE_MAX_PAGES + 20}`, "---", ""].join("\n"),
  );
  assert.equal(rust().readInkNoteMeta(frontmatter).pages, INK_NOTE_MAX_PAGES);
});

test("the text layer splits into pages on its markers and rejoins unchanged", () => {
  const body = [
    "Drop the β sweep for §3.2, see [[Graph-prior module]].",
    "",
    rust().inkPageMarker(2),
    "",
    "![](vault:papers/kipf-2016/page-3.png)",
    "Compare against [[VGAE]] table 2.",
    "",
  ].join("\n");
  const pages = rust().splitInkTextLayer(body);
  assert.equal(pages.length, 2);
  assert.equal(pages[0], "Drop the β sweep for §3.2, see [[Graph-prior module]].");
  assert.equal(pages[1], "![](vault:papers/kipf-2016/page-3.png)\nCompare against [[VGAE]] table 2.");
  assert.equal(rust().splitInkTextLayer(rust().joinInkTextLayer(pages)).length, 2);
  assert.deepEqual(rust().splitInkTextLayer(rust().joinInkTextLayer(pages)), pages);
});

test("a note with no recognised text at all is one empty page, not zero", () => {
  assert.deepEqual(rust().splitInkTextLayer(""), [""]);
  assert.deepEqual(rust().splitInkTextLayer("\n\n"), [""]);
  assert.equal(rust().joinInkTextLayer([""]), "\n");
  assert.deepEqual(rust().splitInkTextLayer(rust().joinInkTextLayer(["", ""])), ["", ""]);
});

test("the sidecar lives under .ink/<note id>, keyed by id so a rename cannot orphan it", () => {
  assert.equal(rust().inkSidecarDir("01JNOTE"), `${INK_SIDECAR_DIR}/01JNOTE`);
  const path = rust().inkChunkPath("01JNOTE", CHUNK_A);
  assert.equal(path, `.ink/01JNOTE/${CHUNK_A}.inkb`);
  assert.deepEqual(rust().parseInkChunkPath(path), { noteId: "01JNOTE", chunkId: CHUNK_A });
  assert.equal(rust().parseInkChunkPath(".ink/01JNOTE/not-a-chunk.inkb"), null);
  assert.equal(rust().parseInkChunkPath("notes/01JNOTE/x.inkb"), null);
  assert.equal(rust().parseInkChunkPath(".ink/01JNOTE/x.inkb/extra"), null);
  assert.equal(rust().parseInkChunkPath(""), null);
});

test("a path-shaped id is refused rather than woven into the folder", () => {
  assert.equal(rust().isInkNoteId("01JNOTE"), true);
  assert.equal(rust().isInkNoteId("../escape"), false);
  assert.equal(rust().isInkNoteId("a/b"), false);
  assert.equal(rust().isInkNoteId(""), false);
  assert.throws(() => rust().inkSidecarDir("../escape"), /unusable note id/);
  assert.throws(() => rust().inkChunkPath("01JNOTE", "../../etc/passwd"), /unusable chunk id/);
  assert.equal(rust().parseInkChunkPath(".ink/../escape/01JABC0DEF0GH0JK0MN0PQ0RS.inkb"), null);
});

test("a chunk id is a ULID: twenty-six characters, sortable by creation", () => {
  const fixed = rust().newInkChunkId({ now: 1_700_000_000_000, randomBytes: (target) => target.fill(7) });
  assert.equal(fixed.length, 26);
  assert.equal(rust().isInkChunkId(fixed), true);
  assert.equal(rust().newInkChunkId({ now: 1_700_000_000_000, randomBytes: (t) => t.fill(7) }), fixed);

  const later = rust().newInkChunkId({ now: 1_700_000_001_000, randomBytes: (t) => t.fill(7) });
  assert.ok(later > fixed, "ids sort by the time they were made");
  assert.notEqual(
    rust().newInkChunkId({ now: 1_700_000_000_000, randomBytes: (t) => t.fill(9) }),
    fixed,
    "and differ when the randomness does",
  );
  // The whole alphabet is Crockford base32, which excludes I, L, O and U.
  assert.equal(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(fixed), true);
});

test("page order: what the note declares first, then whatever else is on disk", () => {
  assert.deepEqual(rust().resolveInkPageOrder([CHUNK_B, CHUNK_A], [CHUNK_A, CHUNK_B]), [CHUNK_B, CHUNK_A]);
  // A chunk that appeared without being recorded is not hidden.
  assert.deepEqual(rust().resolveInkPageOrder([CHUNK_B], [CHUNK_A, CHUNK_B]), [CHUNK_B, CHUNK_A]);
  // A chunk that vanished does not make the note unopenable.
  assert.deepEqual(rust().resolveInkPageOrder([CHUNK_B, CHUNK_A], [CHUNK_B]), [CHUNK_B]);
  // Files that are not chunks are ignored rather than ordered.
  assert.deepEqual(rust().resolveInkPageOrder([], ["notes.md", CHUNK_A]), [CHUNK_A]);
  assert.equal(rust().resolveInkPageOrder([], Array.from({ length: 60 }, () => CHUNK_A)).length, INK_NOTE_MAX_PAGES);
});

test("a page over the stroke budget says so rather than refusing to open", () => {
  const strokes = Array.from({ length: INK_PAGE_STROKE_BUDGET + 1 }, () =>
    rust().makeInkStroke({ points: [0, 0, 10, 10] }),
  );
  assert.equal(rust().inkPageOverBudget(rust().blankInkPage()), false);
  assert.equal(rust().inkPageOverBudget({ ...rust().blankInkPage(), strokes }), true);
});

test("packing a stroke simplifies it and keeps its endpoints", () => {
  const coords: number[] = [];
  for (let i = 0; i < 200; i += 1) coords.push(i * 4, 400 + Math.sin(i / 6) * 12);
  const packed = rust().packInkStroke(coords);
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
  assert.deepEqual(rust().packInkStroke([]), { points: [], pressures: [] });
  assert.deepEqual(rust().packInkStroke([10, 10]), { points: [], pressures: [] });
  assert.deepEqual(rust().packInkStroke([Number.NaN, 1, 2, 3]), { points: [], pressures: [] });
});

test("packing never exceeds the stroke point cap, and keeps the true end", () => {
  const coords: number[] = [];
  for (let i = 0; i < 4_000; i += 1) {
    // A zig-zag: no tolerance removes these without losing the shape.
    coords.push(i, i % 2 === 0 ? 0 : 40);
  }
  const packed = rust().packInkStroke(coords);
  assert.ok(packed.points.length / 2 <= INK_STROKE_MAX_POINTS);
  assert.deepEqual(packed.points.slice(-2), coords.slice(-2));
});

test("pressure that the centreline pass would have dropped is put back (§4.4)", () => {
  // A straight line: Ramer–Douglas–Peucker keeps the two endpoints and nothing
  // else, so every interior point here survives only for its pressure.
  const coords = [0, 0, 10, 0, 20, 0, 30, 0, 40, 0];
  assert.deepEqual(rust().simplifyPathIndices(coords, 1.2), [0, 4], "the centreline needs only the ends");

  // A press that rises and falls is a taper, and losing it loses the stroke's
  // look while its centreline stays correct.
  const tapered = rust().packInkStroke(coords, [0, 190, 220, 190, 0]);
  assert.ok(tapered.points.length / 2 > 2, "the taper kept points the centreline did not");
  assert.deepEqual(tapered.pressures.slice(0, 1), [0]);
  assert.deepEqual(tapered.pressures.slice(-1), [0]);
  assert.ok(Math.max(...tapered.pressures) > 150, "and the press is still in the data");
});

test("pressure that follows the centreline adds no points at all", () => {
  const coords = [0, 0, 10, 0, 20, 0, 30, 0, 40, 0];
  const linear = rust().packInkStroke(coords, [0, 64, 128, 191, 255]);
  assert.equal(linear.points.length / 2, 2, "a linear ramp is implied by its endpoints");
  assert.deepEqual(linear.pressures, [0, 255]);
});

test("pressure of the wrong length is ignored rather than misaligned", () => {
  const coords = [0, 0, 10, 0, 20, 0, 30, 0, 40, 0];
  const packed = rust().packInkStroke(coords, [128, 128]);
  assert.equal(packed.points.length / 2, 2);
  assert.deepEqual(packed.pressures, [0, 0], "a point with no pressure sample stores none");
});

test("a page size that could not fit an Int16 coordinate is clamped", () => {
  assert.deepEqual(rust().clampInkPageSize(0, 0), { width: INK_A4_WIDTH, height: INK_A4_HEIGHT });
  assert.deepEqual(rust().clampInkPageSize(Number.NaN, 12), { width: INK_A4_WIDTH, height: 12 });
  assert.deepEqual(rust().clampInkPageSize(100_000, 100_000), { width: 32767, height: 32767 });
  assert.deepEqual(rust().clampInkPageSize(2100.4, 2970.6), { width: 2100, height: 2971 });
});

/* -------------------------------------------------------------------------
 * The header line inside a stored body
 * ---------------------------------------------------------------------- */


import { parseWorkspaceFile } from "../../src/workspace/deserialize-workspace.js";

test("the body header round-trips the ink metadata and leaves the text layer alone", () => {
  const meta = {
    pages: 2,
    paper: "dotted" as const,
    pageOrder: ["01JABCDEFGHJKMNPQRSTVWXYZ0", "01JABCDEFGHJKMNPQRSTVWXYZ1"],
    recognised: 0.94,
    engine: "windows-ink@1",
    hand: "left" as const,
  };
  const body = rust().writeInkNoteBody(meta, "first page\n\n<!-- page 2 -->\n\nsecond\n");
  assert.ok(rust().isInkNoteBody(body));
  assert.ok(!rust().isInkNoteBody("first page"));
  const read = rust().readInkNoteBody(body);
  assert.deepEqual(read.meta, meta);
  assert.equal(read.text, "first page\n\n<!-- page 2 -->\n\nsecond\n");
});

test("a stray header line at the top of the text layer is damage, not text", () => {
  const meta = { ...rust().defaultInkNoteMeta(), pageOrder: ["01JABCDEFGHJKMNPQRSTVWXYZ0"] };
  const cutOff = "<!-- weaveforge-ink ink-pages=9 ink-paper=blank ink-page-order=01M2B9Q6KR";
  const read = rust().readInkNoteBody(rust().writeInkNoteBody(meta, `${cutOff}\n<!-- weaveforge-ink ink-pages=1 -->\nhello\n`));
  assert.deepEqual(read.meta, meta);
  assert.equal(read.text, "hello\n");
  // A body whose text is only the damage reads as empty, and saves clean.
  assert.equal(rust().readInkNoteBody(rust().writeInkNoteBody(meta, cutOff)).text, "");
});

test("a plain body reads as an empty ink note, which is what a note never inked is", () => {
  const read = rust().readInkNoteBody("just words");
  assert.deepEqual(read.meta, rust().defaultInkNoteMeta());
  assert.equal(read.text, "just words");
});

test("the mirror lifts the header into frontmatter and folds it back on import", () => {
  const meta = { ...rust().defaultInkNoteMeta(), pageOrder: ["01JABCDEFGHJKMNPQRSTVWXYZ0"], recognised: 0.5 };
  const body = rust().writeInkNoteBody(meta, "hello");
  const out = rust().serializeWorkspace({
    papers: [],
    vaultPages: [
      {
        id: "n1", title: "Ink", body, sortOrder: 0,
        createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
      } as never,
    ],
    readingLists: [], readingListItems: [], reportSections: [], experiments: [],
    milestones: [], logEntries: [], relations: [], tags: [],
    collectedAt: "2026-01-01T00:00:00Z",
  }, { id: "8d731734-bdcd-4f08-b648-efd15fdf75da", name: "MSc Thesis" });
  const path = Object.keys(out.files).find((file) => file.endsWith(".ink.md"));
  assert.ok(path, "an ink note is written as .ink.md");
  const content = out.files[path!]!;
  assert.match(content, /weaveforge-type: ink_page/);
  assert.match(content, /ink-page-order/);
  assert.ok(!content.includes("weaveforge-ink"), "the header line does not leak into the file");
  const parsed = parseWorkspaceFile(path!, content);
  assert.equal(parsed?.type, "vault_page");
  assert.deepEqual(rust().readInkNoteBody(parsed!.body).meta, meta);
  assert.equal(rust().readInkNoteBody(parsed!.body).text, "hello");
});

test("a page's background is the first-line image ref, and survives a text replacement", () => {
  assert.equal(rust().inkPageBackground(""), null);
  assert.equal(rust().inkPageBackground("hello\n![page background](vault:u/p/a.png)"), null, "not first line");
  assert.equal(rust().inkPageBackground("![figure](vault:u/p/a.png)"), null, "not a background");
  const withBg = rust().withInkPageBackground("first line\nsecond", "u/p/a.png");
  assert.equal(withBg, "![page background](vault:u/p/a.png)\n\nfirst line\nsecond");
  assert.equal(rust().inkPageBackground(withBg), "u/p/a.png");
  // Recognition replaces the text; re-applying keeps exactly one line, first.
  const again = rust().withInkPageBackground(rust().withInkPageBackground(withBg, "u/p/b.png"), "u/p/b.png");
  assert.equal(again.split("\n").filter((l) => l.startsWith("![page background]")).length, 1);
  assert.equal(rust().inkPageBackground(again), "u/p/b.png");
  assert.equal(rust().withInkPageBackground(withBg, null), "first line\nsecond");
  assert.equal(rust().withInkPageBackground("", "u/p/c.png"), "![page background](vault:u/p/c.png)");
});

test("the chunk's attachment index is the ref's position among the body's vault images", () => {
  const body = "![x](vault:u/p/a.png)\n\n<!-- page 2 -->\n\n![page background](vault:u/p/b.png)\n![x](vault:u/p/a.png)";
  assert.equal(rust().inkAttachmentIndex(body, "u/p/a.png"), 1);
  assert.equal(rust().inkAttachmentIndex(body, "u/p/b.png"), 2);
  assert.equal(rust().inkAttachmentIndex(body, "u/p/none.png"), 0);
  assert.equal(rust().inkAttachmentIndex(body, null), 0);
});
