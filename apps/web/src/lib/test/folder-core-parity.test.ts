import { before, test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultInkNoteMeta as tsDefaultInkNoteMeta,
  writeInkNoteBody as tsWriteInkNoteBody,
  type WorkspaceSnapshot,
} from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "./load-test-core";

let core: RustCore;
before(async () => {
  core = await loadTestCore();
});

// Rust and TS must agree on every input, so the TS copies can be deleted.

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

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

test("workspaceSnapshotCounts counts each collection of the snapshot", () => {
  assert.deepEqual(plain(core.workspaceSnapshotCounts(SNAPSHOT)), {
    papers: 3,
    notes: 4,
    readingLists: 2,
    reportSections: 2,
    experiments: 1,
    milestones: 1,
    logEntries: 2,
    relations: 2,
    tags: 2,
  });
});

