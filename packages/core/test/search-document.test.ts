import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_INDEXED_BODY_CHARS,
  SEARCH_KINDS,
  extractHeadings,
  searchRevision,
  toAnnotationSearchDocs,
  toPdfSearchDocs,
  toSearchDocs,
  type WorkspaceSnapshot,
} from "../src/index.js";

function snapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
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
    collectedAt: "2026-08-05T00:00:00.000Z",
    ...overrides,
  };
}

const note = (over: Record<string, unknown> = {}) =>
  ({
    id: "n1",
    title: "Method",
    body: "",
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    ...over,
  }) as never;

test("extracts h1-h3 headings and ignores headings inside code", () => {
  const body = ["# Title", "## Sub", "#### Too deep", "```", "# not a heading", "```"].join("\n");

  assert.deepEqual(extractHeadings(body), ["Title", "Sub"]);
});

test("notes index body, headings, and hashtags from the body", () => {
  const docs = toSearchDocs(
    snapshot({ vaultPages: [note({ body: "## Baselines\nWe compare #vae and #gan." })] }),
  );

  const doc = docs[0]!;
  assert.equal(doc.id, "note:n1");
  assert.equal(doc.kind, "note");
  assert.deepEqual(doc.headings, ["Baselines"]);
  assert.deepEqual(doc.tags.sort(), ["gan", "vae"]);
  assert.match(doc.body, /We compare/);
  assert.equal(doc.href, "/notes?page=n1");
});

test("tree entities carry an ancestor breadcrumb", () => {
  const docs = toSearchDocs(
    snapshot({
      vaultPages: [
        note({ id: "root", title: "Method" }),
        note({ id: "child", title: "Baselines", parentId: "root" }),
        note({ id: "grand", title: "Ablation", parentId: "child" }),
      ],
    }),
  );

  const byId = new Map(docs.map((d) => [d.entityId, d]));
  assert.equal(byId.get("root")!.path, "");
  assert.equal(byId.get("child")!.path, "Method");
  assert.equal(byId.get("grand")!.path, "Method/Baselines");
});

test("a cyclic parent chain terminates instead of hanging", () => {
  const docs = toSearchDocs(
    snapshot({
      vaultPages: [
        note({ id: "a", title: "A", parentId: "b" }),
        note({ id: "b", title: "B", parentId: "a" }),
      ],
    }),
  );

  assert.equal(docs.length, 2);
  for (const doc of docs) assert.ok(typeof doc.path === "string");
});

test("papers index authors, venue, and identifiers as aliases", () => {
  const docs = toSearchDocs(
    snapshot({
      papers: [
        {
          id: "p1",
          title: "Attention Is All You Need",
          authors: ["Vaswani", "Shazeer"],
          venue: "NeurIPS",
          doi: "10.1/x",
          arxivId: "1706.03762",
          year: 2017,
          abstract: "The dominant sequence transduction models…",
          summary: "",
          tags: ["transformers"],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        } as never,
      ],
    }),
  );

  const doc = docs[0]!;
  assert.ok(doc.aliases.includes("Vaswani"), "authors should be searchable as aliases");
  assert.ok(doc.aliases.includes("NeurIPS"));
  assert.ok(doc.aliases.includes("1706.03762"));
  assert.match(doc.body, /dominant sequence/);
  assert.equal(doc.path, "2017");
});

test("report sections expose their outline number as an alias", () => {
  const docs = toSearchDocs(
    snapshot({
      reportSections: [
        {
          id: "s1",
          title: "Introduction",
          sectionNo: "3.2",
          status: "draft",
          wordCount: 0,
          sortOrder: 0,
          notes: "# Aim\nText.",
          createdAt: "2026-01-01T00:00:00.000Z",
        } as never,
      ],
    }),
  );

  assert.deepEqual(docs[0]!.aliases, ["3.2"]);
  assert.deepEqual(docs[0]!.headings, ["Aim"]);
  assert.equal(docs[0]!.href, "/report?section=s1");
});

test("log entries are titled by date so they can be scanned for", () => {
  const docs = toSearchDocs(
    snapshot({
      logEntries: [
        {
          id: "l1",
          entryDate: "2026-03-14",
          kind: "daily",
          body: "Ran the sweep. #baseline",
          links: [],
          createdAt: "2026-03-14T09:00:00.000Z",
        } as never,
      ],
    }),
  );

  assert.equal(docs[0]!.title, "2026-03-14");
  assert.equal(docs[0]!.path, "2026-03");
  assert.deepEqual(docs[0]!.tags, ["baseline"]);
});

test("oversized bodies are truncated, never dropped", () => {
  const docs = toSearchDocs(
    snapshot({ vaultPages: [note({ body: "x".repeat(MAX_INDEXED_BODY_CHARS + 5_000) })] }),
  );

  assert.equal(docs[0]!.body.length, MAX_INDEXED_BODY_CHARS);
  assert.equal(docs[0]!.title, "Method", "the document is still indexed by title");
});

test("degrees are applied when supplied and default to zero", () => {
  const docs = toSearchDocs(
    snapshot({ vaultPages: [note()] }),
    new Map([["note:n1", 7]]),
  );

  assert.equal(docs[0]!.degree, 7);
  assert.equal(toSearchDocs(snapshot({ vaultPages: [note()] }))[0]!.degree, 0);
});

test("ids are unique across kinds that share an id space", () => {
  const docs = toSearchDocs(
    snapshot({
      vaultPages: [note({ id: "shared" })],
      milestones: [
        { id: "shared", title: "Draft", status: "todo", dependencies: [], compute: [], createdAt: "2026-01-01T00:00:00.000Z" } as never,
      ],
    }),
  );

  assert.equal(new Set(docs.map((d) => d.id)).size, 2);
});

test("every declared kind has a route", () => {
  // Three projections feed the index: the snapshot covers workspace entities,
  // PDF page text and reader highlights each come from the reader. Between them
  // they must cover every declared kind, or a document exists that nothing can
  // navigate to.
  const full = toSearchDocs(
    snapshot({
      vaultPages: [note()],
      papers: [{ id: "p1", title: "P", authors: [], tags: [], createdAt: "", updatedAt: "" } as never],
      readingLists: [{ id: "r1", name: "L", sortOrder: 0, createdAt: "" } as never],
      reportSections: [{ id: "s1", title: "S", status: "draft", wordCount: 0, sortOrder: 0, createdAt: "" } as never],
      experiments: [{ id: "e1", name: "E", status: "planned", config: {}, metrics: {}, artifacts: [], createdAt: "" } as never],
      milestones: [{ id: "m1", title: "M", status: "todo", dependencies: [], compute: [], createdAt: "" } as never],
      logEntries: [{ id: "l1", entryDate: "2026-01-01", kind: "daily", body: "", links: [], createdAt: "" } as never],
    }),
  );

  const pdfPages = toPdfSearchDocs([
    {
      paperId: "p1",
      title: "P",
      extractedAt: "2026-01-01T00:00:00.000Z",
      pages: [{ pageIndex: 0, text: "Enough page text to clear the minimum length bar." }],
    },
  ]);
  const annotations = toAnnotationSearchDocs(
    [
      {
        id: "a1",
        paperId: "p1",
        pageIndex: 0,
        origin: "local",
        zoteroKey: null,
        type: "highlight",
        color: "#ffd400",
        text: "A highlighted passage.",
        comment: "",
        tags: [],
        anchor: {},
        sortIndex: "00000|0000|0000",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    new Map([["p1", "P"]]),
  );
  const everyDoc = [...full, ...pdfPages, ...annotations];

  assert.deepEqual([...new Set(everyDoc.map((d) => d.kind))].sort(), [...SEARCH_KINDS].sort());
  for (const doc of everyDoc) assert.match(doc.href, /^\//, `${doc.kind} has no route`);
});

test("revision changes when content is edited or removed", () => {
  const base = toSearchDocs(snapshot({ vaultPages: [note()] }));
  const edited = toSearchDocs(
    snapshot({ vaultPages: [note({ updatedAt: "2026-03-01T00:00:00.000Z" })] }),
  );
  const removed = toSearchDocs(snapshot());

  assert.notEqual(searchRevision(base), searchRevision(edited), "an edit must invalidate the cache");
  assert.notEqual(searchRevision(base), searchRevision(removed), "a deletion must invalidate it");
  assert.equal(searchRevision(base), searchRevision(toSearchDocs(snapshot({ vaultPages: [note()] }))));
});
