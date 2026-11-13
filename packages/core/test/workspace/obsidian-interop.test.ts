import { rust } from "../../src/shared/rust.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceSnapshot } from "../../src/index.js";

function snapshot(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    papers: [], vaultPages: [], readingLists: [], readingListItems: [],
    reportSections: [], experiments: [], milestones: [], logEntries: [],
    relations: [], tags: [], collectedAt: "2026-08-05T00:00:00.000Z", ...over,
  };
}

const note = (over: Record<string, unknown> = {}) =>
  ({
    id: "n1", title: "Method", body: "Body text.", sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z", ...over,
  }) as never;

const paper = (over: Record<string, unknown> = {}) =>
  ({
    id: "p1", title: "Attention", authors: ["Vaswani"], status: "unread", tags: [],
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z", ...over,
  }) as never;

const PROJECT = { id: "8d731734-bdcd-4f08-b648-efd15fdf75da", name: "MSc Thesis" };

// ------------------------------------------------------------------- aliases

test("every mirrored file declares its title as an alias", () => {
  const { files } = rust().serializeWorkspace(
    snapshot({ vaultPages: [note({ title: "Method Notes" })] }),
    PROJECT,
  );
  const [path] = Object.keys(files);
  // The suffix is what makes the alias necessary: the basename is not the title.
  assert.ok(path!.endsWith(".note.md"));
  assert.deepEqual(rust().readFrontmatter(files[path!]!).frontmatter.aliases, ["Method Notes"]);
});

test("papers carry an alias too, so a citation key is not the only handle", () => {
  const { files } = rust().serializeWorkspace(snapshot({ papers: [paper()] }), PROJECT);
  const [path] = Object.keys(files);
  assert.deepEqual(rust().readFrontmatter(files[path!]!).frontmatter.aliases, ["Attention"]);
});

test("an alias survives a round trip back into the workspace", () => {
  const { files } = rust().serializeWorkspace(
    snapshot({ vaultPages: [note({ title: "Method Notes" })] }),
    PROJECT,
  );
  const parsed = rust().parseWorkspaceFolder(files);
  // The extra key is ignored on the way in: identity is still the id.
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.id, "n1");
  assert.equal(parsed[0]!.type, "vault_page");
});

// ---------------------------------------------------------------------- tags
// The tag rules (hyphenating, dedupe, no empty key) are Rust's `obsidian_tags`,
// with literal asserts in crates/wf-core/tests/sync_serialize.rs.

test("a paper's tags reach the file in their safe form", () => {
  const { files } = rust().serializeWorkspace(
    snapshot({ papers: [paper({ tags: ["machine learning"] })] }),
    PROJECT,
  );
  const [path] = Object.keys(files);
  assert.deepEqual(rust().readFrontmatter(files[path!]!).frontmatter.tags, ["machine-learning"]);
});

// ------------------------------------------------------- reading foreign YAML

test("a block list is read, because that is how other editors write lists", () => {
  const { frontmatter, body } = rust().readFrontmatter(
    ["---", "title: Method", "tags:", "  - alpha", "  - beta", "---", "Body."].join("\n"),
  );
  assert.deepEqual(frontmatter.tags, ["alpha", "beta"]);
  assert.equal(frontmatter.title, "Method");
  assert.equal(body, "Body.");
});

test("quoted block items keep their punctuation", () => {
  const { frontmatter } = rust().readFrontmatter(
    ["---", "aliases:", '  - "Method, revised"', "  - 'Method v2'", "---", ""].join("\n"),
  );
  assert.deepEqual(frontmatter.aliases, ["Method, revised", "Method v2"]);
});

test("a single-quoted scalar unquotes, doubled quote and all", () => {
  const { frontmatter } = rust().readFrontmatter(["---", "title: 'It''s here'", "---", ""].join("\n"));
  assert.equal(frontmatter.title, "It's here");
});

test("a nested map leaves no key rather than an empty one", () => {
  const { frontmatter } = rust().readFrontmatter(
    ["---", "title: Method", "cssclasses:", "  wide: true", "---", ""].join("\n"),
  );
  assert.equal("cssclasses" in frontmatter, false);
  assert.equal(frontmatter.title, "Method");
});

test("a key after a block list is still read", () => {
  const { frontmatter } = rust().readFrontmatter(
    ["---", "tags:", "  - alpha", "weaveforge-id: n1", "---", ""].join("\n"),
  );
  assert.equal(frontmatter["weaveforge-id"], "n1");
  assert.deepEqual(frontmatter.tags, ["alpha"]);
});

test("an inline list still wins over the block scan", () => {
  const { frontmatter } = rust().readFrontmatter(["---", "tags: [alpha, beta]", "---", ""].join("\n"));
  assert.deepEqual(frontmatter.tags, ["alpha", "beta"]);
});

test("what we write still reads back byte-identically", () => {
  const source = rust().writeFrontmatter({ "weaveforge-id": "n1", aliases: ["Method"] }, "Body.");
  const parsed = rust().readFrontmatter(source);
  assert.deepEqual(parsed.frontmatter.aliases, ["Method"]);
  assert.equal(rust().writeFrontmatter(parsed.frontmatter, parsed.body), source);
});
