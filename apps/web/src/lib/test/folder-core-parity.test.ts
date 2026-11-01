import { before, test } from "node:test";
import assert from "node:assert/strict";
import {
  serializeWorkspace as tsSerializeWorkspace,
  workspaceSnapshotCounts as tsWorkspaceSnapshotCounts,
  parseWorkspaceFolder as tsParseWorkspaceFolder,
  diffWorkspace as tsDiffWorkspace,
  jsonDataPath as tsJsonDataPath,
  parseJsonData as tsParseJsonData,
  diffJsonData as tsDiffJsonData,
  countJsonActions as tsCountJsonActions,
  addCounts as tsAddCounts,
  JSON_KINDS,
  defaultInkNoteMeta as tsDefaultInkNoteMeta,
  writeInkNoteBody as tsWriteInkNoteBody,
  type WorkspaceSnapshot,
  type ExistingEntity,
  type ChangeSide,
  type JsonRow,
} from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "./load-test-core";

let core: RustCore;
before(async () => {
  core = await loadTestCore();
});

// Rust and TS must agree on every input, so the TS copies can be deleted.

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

const SIDES: ChangeSide[] = ["neither", "folder", "workspace", "both", "unknown"];
const PROJECT = { id: "proj-1234567890", name: "My Thesis" };
const AT = "2026-01-02T03:04:05.000Z";

const SNAPSHOT = {
  papers: [
    {
      id: "p-full",
      title: "Full paper",
      authors: ["Ada Lovelace", "Alan Turing"],
      year: 2024,
      venue: "NeurIPS",
      doi: "10.1000/xyz",
      arxivId: "2401.00001",
      url: "https://example.org/p",
      abstract: "An abstract.",
      summary: "A summary.",
      status: "reading",
      rating: 4,
      tags: ["ml", "Deep Learning", "a/b"],
      metadata: {},
      createdAt: AT,
      updatedAt: "2026-01-03T00:00:00.000Z",
    },
    {
      id: "p-null",
      title: "Ünïcødé 論文",
      authors: [],
      status: "to_read",
      tags: [],
      metadata: {},
      createdAt: AT,
      updatedAt: AT,
    },
    {
      id: "p-missing",
      title: 'Note: # "quotes"',
      authors: ["Grace Hopper"],
      status: "read",
      tags: [],
      metadata: {},
      createdAt: AT,
      updatedAt: AT,
    },
  ],
  vaultPages: [
    {
      id: "n-plain",
      title: "Plain",
      body: "# Plain\n\nSome text.\n\n![x](vault:img/a.png)\n",
      sortOrder: 0,
      pinned: true,
      folder: false,
      createdAt: AT,
      updatedAt: AT,
    },
    {
      id: "n-child",
      title: "Child",
      body: "Child body",
      parentId: "n-plain",
      sortOrder: 1,
      createdAt: AT,
      updatedAt: AT,
    },
    {
      id: "n-conflict",
      title: "Conflicted",
      body: "<<<<<<< this app\nmine\n=======\ntheirs\n>>>>>>> folder\n",
      sortOrder: 2,
      createdAt: AT,
      updatedAt: AT,
    },
    {
      id: "n-ink",
      title: "Sketch",
      body: tsWriteInkNoteBody(tsDefaultInkNoteMeta(), "line 1\n\nline 2"),
      sortOrder: 3,
      createdAt: AT,
      updatedAt: AT,
    },
  ],
  readingLists: [
    { id: "rl-1", name: "Core", sortOrder: 0, createdAt: AT },
    {
      id: "rl-2",
      name: "Sub",
      description: "nested",
      parentId: "rl-1",
      color: "#ff0000",
      sortOrder: 1,
      createdAt: AT,
    },
  ],
  readingListItems: [
    { id: "rli-1", listId: "rl-1", paperId: "p-full", sortOrder: 0, note: undefined },
    {
      id: "rli-2",
      listId: "rl-2",
      vaultPageId: "n-plain",
      sortOrder: 0,
      note: "nested note",
      inheritedFromListId: "rl-1",
    },
  ],
  reportSections: [
    {
      id: "rs-1",
      title: "Introduction",
      status: "drafting",
      wordCount: 120,
      sortOrder: 0,
      createdAt: AT,
    },
    {
      id: "rs-2",
      title: "Methods",
      sectionNo: "2.1",
      status: "not_started",
      wordCount: 0,
      targetWords: 1500,
      deadline: "2026-12-01",
      notes: "Needs data",
      sortOrder: 1,
      createdAt: AT,
      updatedAt: AT,
    },
  ],
  experiments: [
    {
      id: "e-1",
      name: "Run",
      hypothesis: "H",
      status: "running",
      repoUrl: "https://example.org/repo",
      commitSha: "abc123",
      branch: "main",
      runCommand: "python run.py",
      config: { lr: 0.1 },
      metrics: { acc: 0.9 },
      artifacts: ["a.bin"],
      resultNote: "ok",
      startedAt: AT,
      finishedAt: AT,
      relatedPaper: "p-full",
      createdAt: AT,
    },
  ],
  milestones: [
    {
      id: "m-1",
      title: "Proposal",
      description: "Write it",
      status: "planned",
      targetDate: "2026-12-31",
      dependencies: [{ kind: "paper", refId: "p-full", label: "Read" }],
      compute: [{ resource: "gpu", count: 2, hours: 10, notes: "x" }],
      createdAt: AT,
    },
  ],
  logEntries: [
    { id: "log-1", entryDate: "2026-11-01", kind: "daily", body: "Did things", links: [{ type: "paper", id: "p-full" }], createdAt: AT },
    { id: "log-2", entryDate: "2026-11-01", kind: "weekly", body: "Week", links: [], createdAt: AT },
  ],
  relations: [
    { id: "rel-1", fromPaper: "p-full", toPaper: "p-null", relation: "cites", note: "n", source: "manual", createdAt: AT },
    {
      id: "rel-2",
      fromPaper: "p-null",
      toPaper: "p-missing",
      relation: "similar",
      note: undefined,
      source: "auto",
      createdAt: AT,
      layout: { x: { y: [1, 2] } },
    },
  ],
  tags: [
    { id: "t-1", name: "ml", color: "#00ff00" },
    { id: "t-2", name: "Deep Learning", color: undefined },
  ],
  readerAnnotations: [
    {
      id: "ra-1",
      origin: "local",
      zoteroKey: null,
      type: "highlight",
      color: "#ffff00",
      text: "Quote",
      comment: "Comment",
      tags: ["x"],
      anchor: {},
      sortIndex: "00001",
      createdAt: AT,
      updatedAt: AT,
      paperId: "p-full",
      pageIndex: 0,
    },
  ],
  collectedAt: "2026-11-01T00:00:00.000Z",
} as unknown as WorkspaceSnapshot;

const EMPTY_SNAPSHOT = {
  papers: [],
  vaultPages: [],
  readingLists: [],
  readingListItems: [],
  reportSections: [],
  experiments: [],
  milestones: [],
  logEntries: [],
  relations: [],
  tags: [],
  readerAnnotations: [],
  collectedAt: "2026-11-01T00:00:00.000Z",
} as unknown as WorkspaceSnapshot;

const HAND_FILES: Record<string, string> = {
  "notes/no-frontmatter.md": "just text",
  "notes/bad.md": "---\nweaveforge-id: [\n---\nbody",
  "random/elsewhere.md": "---\ntitle: x\n---\n",
  "notes/empty.md": "",
  "readme.txt": "a plain text file",
};

/** One side per path, by path order, so both diff calls see the same answers. */
function sidesFor(paths: string[]): Map<string, ChangeSide> {
  const unique = [...new Set(paths)].sort();
  return new Map(unique.map((path, i) => [path, SIDES[i % SIDES.length] ?? "unknown"]));
}

const JSON_ROWS_PARSED = [
  { id: "r1", a: 1 },
  { id: "r2", a: 2 },
  { id: "r3", a: 1 },
  { a: 9 },
];
const JSON_ROWS_EXISTING: Record<string, unknown>[] = [
  { id: "r1", a: 1, note: undefined },
  { id: "r2", a: 1 },
  { id: "r4", a: 1 },
];

function jsonParsed(kind: (typeof JSON_KINDS)[number]) {
  return tsParseJsonData(tsJsonDataPath("", kind), JSON.stringify(JSON_ROWS_PARSED), kind);
}

/** Every TS json diff entry across kinds and sides, for the counting tests. */
function jsonEntries() {
  const entries: ReturnType<typeof tsDiffJsonData>["entries"] = [];
  for (const kind of JSON_KINDS) {
    const parsed = jsonParsed(kind);
    if (!parsed) continue;
    const existing = JSON_ROWS_EXISTING as JsonRow[];
    entries.push(...tsDiffJsonData(parsed, existing).entries);
    for (const side of SIDES) {
      entries.push(...tsDiffJsonData(parsed, existing, { origin: () => side }).entries);
    }
  }
  return entries;
}

test("serializeWorkspace matches the TS copy", () => {
  assert.deepEqual(plain(core.serializeWorkspace(SNAPSHOT, PROJECT)), plain(tsSerializeWorkspace(SNAPSHOT, PROJECT)));
  assert.deepEqual(plain(core.serializeWorkspace(EMPTY_SNAPSHOT, PROJECT)), plain(tsSerializeWorkspace(EMPTY_SNAPSHOT, PROJECT)));
  const other = { id: "x", name: "" };
  assert.deepEqual(plain(core.serializeWorkspace(SNAPSHOT, other)), plain(tsSerializeWorkspace(SNAPSHOT, other)));
});

test("workspaceSnapshotCounts matches the TS copy", () => {
  assert.deepEqual(plain(core.workspaceSnapshotCounts(SNAPSHOT)), plain(tsWorkspaceSnapshotCounts(SNAPSHOT)));
});

test("parseWorkspaceFolder matches the TS copy", () => {
  const files = { ...tsSerializeWorkspace(SNAPSHOT, PROJECT).files, ...HAND_FILES };
  assert.deepEqual(plain(core.parseWorkspaceFolder(files)), plain(tsParseWorkspaceFolder(files)));
});

test("diffWorkspace matches the TS copy with and without origin", () => {
  const files = { ...tsSerializeWorkspace(SNAPSHOT, PROJECT).files, ...HAND_FILES };
  const parsed = tsParseWorkspaceFolder(files);
  const existing: ExistingEntity[] = [];
  parsed.forEach((entity, i) => {
    if (entity.id === undefined) return;
    if (i === 0) existing.push({ id: entity.id, type: entity.type, title: entity.title, body: entity.body });
    else if (i === 1) existing.push({ id: entity.id, type: entity.type, title: `${entity.title} (edited)`, body: entity.body });
    else if (i === 2) existing.push({ id: entity.id, type: entity.type, title: entity.title, body: `${entity.body}\nedit` });
    else if (i === 3) existing.push({ id: entity.id, type: entity.type === "paper" ? "vault_page" : "paper", title: entity.title, body: entity.body });
    // Later entities get no existing row.
  });
  existing.push({ id: "gone-1", type: "paper", title: "Gone", body: "" });

  assert.deepEqual(plain(core.diffWorkspace(parsed, existing)), plain(tsDiffWorkspace(parsed, existing)));

  const sides = sidesFor(parsed.map((entity) => entity.path));
  const origin = (path: string) => sides.get(path) ?? "unknown";
  assert.deepEqual(
    plain(core.diffWorkspace(parsed, existing, { origin })),
    plain(tsDiffWorkspace(parsed, existing, { origin })),
  );
});

test("jsonDataPath matches the TS copy for every kind", () => {
  for (const root of ["", "My-Thesis--123456"]) {
    for (const kind of JSON_KINDS) {
      assert.equal(core.jsonDataPath(root, kind), tsJsonDataPath(root, kind), `${root} ${kind}`);
    }
  }
});

test("parseJsonData matches the TS copy on valid and malformed input", () => {
  const path = tsJsonDataPath("My-Thesis--123456", "tags");
  const cases = [
    JSON.stringify([{ id: "a", n: 1 }, { id: "b", nested: { x: [1] } }, { n: 2 }]),
    "[]",
    "not json",
    "{}",
    "[1, 2]",
    '[{"id":"a"}, 3]',
    "",
  ];
  for (const content of cases) {
    for (const kind of JSON_KINDS) {
      assert.deepEqual(
        plain(core.parseJsonData(path, content, kind)),
        plain(tsParseJsonData(path, content, kind)),
        JSON.stringify(content),
      );
    }
  }
});

test("diffJsonData matches the TS copy for every kind and origin", () => {
  for (const kind of JSON_KINDS) {
    const parsed = jsonParsed(kind);
    assert.ok(parsed, kind);
    const existing = JSON_ROWS_EXISTING as JsonRow[];
    assert.deepEqual(
      plain(core.diffJsonData(parsed, existing)),
      plain(tsDiffJsonData(parsed, existing)),
      `${kind} without origin`,
    );
    for (const side of SIDES) {
      const options = { origin: () => side };
      assert.deepEqual(
        plain(core.diffJsonData(parsed, existing, options)),
        plain(tsDiffJsonData(parsed, existing, options)),
        `${kind} ${side}`,
      );
    }
  }
});

test("countJsonActions and addCounts match the TS copy", () => {
  const entries = jsonEntries();
  assert.deepEqual(plain(core.countJsonActions(entries)), plain(tsCountJsonActions(entries)));

  const half = Math.floor(entries.length / 2);
  const a = tsCountJsonActions(entries.slice(0, half));
  const b = tsCountJsonActions(entries.slice(half));
  assert.deepEqual(plain(core.addCounts(a, b)), plain(tsAddCounts(a, b)));
});
