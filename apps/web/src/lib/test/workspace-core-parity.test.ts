import { before, test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeRows as tsMergeRows,
  sameValue as tsSameValue,
  isInkChunkId as tsIsInkChunkId,
  isInkNoteBody as tsIsInkNoteBody,
  readInkNoteBody as tsReadInkNoteBody,
  writeInkNoteBody as tsWriteInkNoteBody,
  defaultInkNoteMeta as tsDefaultInkNoteMeta,
  markdownImage as tsMarkdownImage,
  imageAltFromFilename as tsImageAltFromFilename,
  imageExtensionForMime as tsImageExtensionForMime,
  imagePathsInBody as tsImagePathsInBody,
  normalizeMarkdownImageSyntax as tsNormalizeMarkdownImageSyntax,
  projectDir as tsProjectDir,
  projectMetaDir as tsProjectMetaDir,
  idSuffix as tsIdSuffix,
  stripKindSuffix as tsStripKindSuffix,
  type InkNoteMeta,
  type WorkspaceEntityType,
} from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "./load-test-core";

let core: RustCore;
before(async () => {
  core = await loadTestCore();
});

// Rust and TS must agree on every input, so the TS copies can be deleted.

const MERGE_CASES: [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>][] = [
  // (a) no change
  [{ title: "a", n: 1 }, { title: "a", n: 1 }, { title: "a", n: 1 }],
  // (b) only local changed
  [{ title: "a", n: 1 }, { title: "b", n: 1 }, { title: "a", n: 1 }],
  // (c) only remote changed
  [{ title: "a", n: 1 }, { title: "a", n: 1 }, { title: "a", n: 2 }],
  // (d) both changed to the same value
  [{ title: "a" }, { title: "b" }, { title: "b" }],
  // (e) both changed differently: conflict
  [{ t: "a" }, { t: "b" }, { t: "c" }],
  // (f) updated_at changed on both sides: later wins
  [
    { updated_at: "2023-12-31T00:00:00Z" },
    { updated_at: "2024-01-01T00:00:00Z" },
    { updated_at: "2024-01-02T00:00:00Z" },
  ],
  [
    { updated_at: "2023-12-31T00:00:00Z" },
    { updated_at: "2024-01-02T00:00:00Z" },
    { updated_at: "2024-01-01T00:00:00Z" },
  ],
  // (g) reserved fields
  [
    { id: 1, server_seq: 1 },
    { id: 2, server_seq: 2 },
    { id: 3, server_seq: 3 },
  ],
  // (h) jsonb objects with different key order
  [{ meta: { a: 1, b: 2 } }, { meta: { b: 2, a: 1, c: 3 } }, { meta: { a: 1, b: 2 } }],
  [{ meta: { a: 1, b: 2 } }, { meta: { b: 2, a: 1 } }, { meta: { a: 9, b: 2 } }],
  // (i) timestamps: same instant in different offsets
  [
    { at: "2024-01-01T00:00:00Z" },
    { at: "2024-01-01T01:00:00+01:00" },
    { at: "2024-01-01T00:00:00Z", n: 1 },
  ],
  // (j) field only in remote
  [{ a: 1 }, { a: 1 }, { a: 1, extra: "r" }],
  // (k) nested arrays
  [{ tags: [1, [2, 3]] }, { tags: [1, [2, 4]] }, { tags: [1, [2, 3], 5] }],
];

const SAME_VALUE_PAIRS: [unknown, unknown][] = [
  [null, null],
  ["a", "a"],
  ["a", "b"],
  [1, 1],
  [1, "1"],
  [true, true],
  [{ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }],
  [[1, 2], [2, 1]],
  ["2024-01-01T00:00:00Z", "2024-01-01 00:00:00+00"],
  ["2024-01-01T00:00:00Z", "2024-01-01T00:00:00.000Z"],
  ["not a date", "not a date"],
  [0, null],
  ["", null],
];

const ID_INPUTS = [
  "01HZX3K9Q7M2N5P8R4T6V0W1XY",
  "01J5Z8A3B7C2D9E4F6G1H0K5MN",
  "",
  "../x",
  "a b",
  "a".repeat(200),
];

const DEFAULT_META: InkNoteMeta = tsDefaultInkNoteMeta();
const META: InkNoteMeta = {
  pages: 3,
  paper: "dotted",
  pageOrder: ["01HZX3K9Q7M2N5P8R4T6V0W1XY", "01J5Z8A3B7C2D9E4F6G1H0K5MN"],
  recognised: 0.75,
  engine: "myscript",
  hand: "left",
};
const GRID_META: InkNoteMeta = { pages: 2, paper: "grid", pageOrder: [], recognised: 0.5, engine: "x", hand: "left" };
const META_CASES = [DEFAULT_META, META, GRID_META];

const WRITTEN_META = tsWriteInkNoteBody(META, "line 1\n\nline 2");
const INK_BODIES = [
  "",
  "# plain",
  tsWriteInkNoteBody(DEFAULT_META, ""),
  WRITTEN_META,
  // An unknown paper value, as a hand-edited header would carry it.
  WRITTEN_META.replace("ink-paper=dotted", "ink-paper=weird"),
  WRITTEN_META.replace(/\n/g, "\r\n"),
];

const MARKDOWN_IMAGE_BODIES = [
  "no images here",
  "![a](vault:x.png)",
  "![a](vault:x.png) and ![a](vault:x.png)",
  "![a](vault:x.png) ![b](paperimg:y.png) ![c](vault:x.png)",
  '![a](vault:x.png "title")',
  "![a](<vault:x.png>)",
  '<img src="vault:x.png">',
  "![a\n](vault:x.png)",
  "![p](paperimg:p/a.png)\n![r](reportimg:r/b.jpg)",
  "![a](https://example.com/x.png)",
];

const ENTITY_TYPES: WorkspaceEntityType[] = [
  "vault_page",
  "ink_page",
  "paper",
  "reading_list",
  "report_section",
  "experiment",
  "milestone",
  "log_entry",
];

test("mergeRows matches the TS merge", () => {
  for (const [base, local, remote] of MERGE_CASES) {
    assert.deepEqual(
      core.mergeRows(base, local, remote),
      tsMergeRows(base, local, remote),
      JSON.stringify([base, local, remote]),
    );
  }
});

test("sameValue matches the TS comparison", () => {
  for (const [a, b] of SAME_VALUE_PAIRS) {
    assert.deepEqual(core.sameValue(a, b), tsSameValue(a, b), JSON.stringify([a, b]));
  }
});

test("isInkChunkId matches the TS check", () => {
  for (const id of ID_INPUTS) {
    assert.deepEqual(core.isInkChunkId(id), tsIsInkChunkId(id), JSON.stringify(id.slice(0, 40)));
  }
});

test("isInkNoteBody and readInkNoteBody match the TS reader", () => {
  for (const body of INK_BODIES) {
    assert.deepEqual(core.isInkNoteBody(body), tsIsInkNoteBody(body), JSON.stringify(body));
    assert.deepEqual(core.readInkNoteBody(body), tsReadInkNoteBody(body), JSON.stringify(body));
  }
});

test("writeInkNoteBody matches the TS writer", () => {
  for (const meta of META_CASES) {
    for (const text of ["", "x", "a\n\nb"]) {
      assert.deepEqual(
        core.writeInkNoteBody(meta, text),
        tsWriteInkNoteBody(meta, text),
        JSON.stringify([meta, text]),
      );
    }
  }
});

test("defaultInkNoteMeta matches the TS default", () => {
  assert.deepEqual(core.defaultInkNoteMeta(), tsDefaultInkNoteMeta());
});

test("markdownImage matches the TS builder", () => {
  const cases: [string, string][] = [
    ["vault:x.png", "photo"],
    ["paperimg:a/b c.png", ""],
    ["vault:x.png", "a [b] c"],
    ["vault:x.png", "line\nbreak"],
    ["vault:x.png", "back\\slash"],
  ];
  for (const [target, alt] of cases) {
    assert.deepEqual(core.markdownImage(target, alt), tsMarkdownImage(target, alt), JSON.stringify([target, alt]));
  }
});

test("imageAltFromFilename matches the TS alt text", () => {
  const names: (string | undefined)[] = [
    undefined,
    "",
    "photo.png",
    "my_photo-1.JPG",
    "no-ext",
    ".hidden",
    "image.png",
  ];
  for (const name of names) {
    assert.deepEqual(core.imageAltFromFilename(name), tsImageAltFromFilename(name), JSON.stringify(name));
  }
  // `null` is not in the TS type, but the Rust side accepts it: both must give the same answer.
  assert.deepEqual(core.imageAltFromFilename(null), tsImageAltFromFilename(null as unknown as string));
});

test("imageExtensionForMime matches the TS mapping", () => {
  for (const mime of ["image/png", "image/jpeg", "image/svg+xml", "image/webp", "text/plain", ""]) {
    assert.deepEqual(core.imageExtensionForMime(mime), tsImageExtensionForMime(mime), JSON.stringify(mime));
  }
});

test("imagePathsInBody matches the TS scan", () => {
  for (const body of MARKDOWN_IMAGE_BODIES) {
    for (const prefix of ["vault:", "paperimg:"]) {
      assert.deepEqual(
        core.imagePathsInBody(body, prefix),
        tsImagePathsInBody(body, prefix),
        JSON.stringify([body, prefix]),
      );
    }
  }
});

test("normalizeMarkdownImageSyntax matches the TS normaliser", () => {
  for (const body of MARKDOWN_IMAGE_BODIES) {
    assert.deepEqual(
      core.normalizeMarkdownImageSyntax(body),
      tsNormalizeMarkdownImageSyntax(body),
      JSON.stringify(body),
    );
  }
});

test("toRelativeBlobLinks re-anchors a vault image under the note's depth", () => {
  const { body } = core.toRelativeBlobLinks("![](vault:user-1/n1/diagram.png)", "notes/method/baselines.note.md");
  assert.equal(body, "![](../../assets/notes/user-1/n1/diagram.png)");
});

test("relativeAssetPaths reads back the storage path of a vault image", () => {
  assert.deepEqual(core.relativeAssetPaths("![](../../assets/notes/user-1/n1/diagram.png)"), [
    { scope: "notes", path: "user-1/n1/diagram.png" },
  ]);
});

test("projectDir matches the TS folder name", () => {
  const projects = [
    { id: "1234567890abcdef", name: "My Thesis" },
    { id: "1234567890abcdef", name: "論文 ñ" },
    { id: "abc", name: "" },
    { id: "p-1/2", name: "a/b/c" },
  ];
  for (const project of projects) {
    assert.deepEqual(core.projectDir(project), tsProjectDir(project), JSON.stringify(project));
  }
});

// Literal values: the TS entityDir is gone, so these pin the Rust ENTITY_DIRS table.
test("entityDir gives the top-level folder per type, under a project root when given", () => {
  const top: Record<WorkspaceEntityType, string> = {
    vault_page: "notes",
    ink_page: "notes",
    paper: "papers",
    reading_list: "reading-lists",
    report_section: "report",
    experiment: "experiments",
    milestone: "plan",
    log_entry: "logbook",
  };
  for (const type of ENTITY_TYPES) {
    assert.equal(core.entityDir(type, ""), top[type], `${type} no root`);
    assert.equal(core.entityDir(type, "p--1"), `p--1/${top[type]}`, `${type} under p--1`);
  }
});

test("projectMetaDir, idSuffix and stripKindSuffix match the TS helpers", () => {
  for (const root of ["", "p--1"]) {
    assert.deepEqual(core.projectMetaDir(root), tsProjectMetaDir(root), JSON.stringify(root));
  }
  for (const id of ["abc", "0123456789abcdef-xyz", ""]) {
    assert.deepEqual(core.idSuffix(id), tsIdSuffix(id), JSON.stringify(id));
  }
  const names = [
    "methods--a1b2c3.note.md",
    "x.ink.md",
    "x.paper.md",
    "x.list.md",
    "x.report.md",
    "x.experiment.md",
    "x.milestone.md",
    "x.log.md",
    "plain.md",
    "noext",
    "x.unknown.md",
    "x.pdf",
  ];
  for (const name of names) {
    assert.deepEqual(core.stripKindSuffix(name), tsStripKindSuffix(name), JSON.stringify(name));
  }
});

test("jsonKindOfPath and isAppOwnedPath keep their literal path rules", () => {
  // [path, jsonKindOfPath, isAppOwnedPath]: the kind is by basename, so a bare "tags.json" is a kind.
  const cases: [string, string | null, boolean][] = [
    [".weaveforge/relations.json", "relations", false],
    ["p--1/.weaveforge/tags.json", "tags", false],
    ["p--1/.weaveforge/reading-list-items.json", "reading_list_items", false],
    ["p--1/.weaveforge/mirror.json", null, true],
    ["p--1/.weaveforge/db/x", null, true],
    ["x/reading_list_items.json", null, false],
    ["notes/a.md", null, false],
    ["tags.json", "tags", false],
    [".git/config", null, true],
    ["README.md", null, true],
    ["papers/pdf/a.pdf", null, true],
    ["x/papers/html/b.html", null, true],
    ["p--1/.weaveforge/manifest.json", null, true],
    ["p--1/.weaveforge/cache/z", null, true],
  ];
  for (const [path, kind, owned] of cases) {
    assert.equal(core.jsonKindOfPath(path), kind, path);
    assert.equal(core.isAppOwnedPath(path), owned, path);
  }
});

// Literal expectations for the Rust rules that replaced the deleted TS helpers.

test("diffBody lists shared lines and the hunk between them", () => {
  assert.deepEqual(core.diffBody("a\nb\nc", "a\nB\nc"), {
    lines: [
      { op: "same", text: "a" },
      { op: "ours", text: "b" },
      { op: "theirs", text: "B" },
      { op: "same", text: "c" },
    ],
    hunks: [{ index: 0, ours: ["b"], theirs: ["B"] }],
  });
  assert.deepEqual(core.diffBody("", ""), { lines: [{ op: "same", text: "" }], hunks: [] });
});

test("hasConflictMarkers finds WeaveForge and git markers, not a bare =======", () => {
  assert.equal(core.hasConflictMarkers("<<<<<<< this app\na\n=======\nb\n>>>>>>> the folder\n"), true);
  assert.equal(core.hasConflictMarkers("<<<<<<< this app\r\na\r\n=======\r\nb\r\n>>>>>>> the folder\r\n"), true);
  assert.equal(core.hasConflictMarkers("<<<<<<< HEAD\na\n=======\nb\n>>>>>>> branch"), true);
  assert.equal(core.hasConflictMarkers("plain"), false);
  assert.equal(core.hasConflictMarkers("text with <<<<<<< in the middle"), false);
  assert.equal(core.hasConflictMarkers("x ======= y"), false);
  assert.equal(core.hasConflictMarkers(""), false);
});
