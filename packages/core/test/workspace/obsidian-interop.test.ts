import assert from "node:assert/strict";
import test from "node:test";
import {
  obsidianTags,
  parseWorkspaceFolder,
  readFrontmatter,
  serializeWorkspace,
  writeFrontmatter,
  type WorkspaceSnapshot,
} from "../../src/index.js";

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

// ------------------------------------------------------------------- aliases

test("every mirrored file declares its title as an alias", () => {
  const { files } = serializeWorkspace(
    snapshot({ vaultPages: [note({ title: "Method Notes" })] }),
  );
  const [path] = Object.keys(files);
  // The suffix is what makes the alias necessary: the basename is not the title.
  assert.ok(path!.endsWith(".note.md"));
  assert.deepEqual(readFrontmatter(files[path!]!).frontmatter.aliases, ["Method Notes"]);
});

test("papers carry an alias too, so a citation key is not the only handle", () => {
  const { files } = serializeWorkspace(snapshot({ papers: [paper()] }));
  const [path] = Object.keys(files);
  assert.deepEqual(readFrontmatter(files[path!]!).frontmatter.aliases, ["Attention"]);
});

test("an alias survives a round trip back into the workspace", () => {
  const { files } = serializeWorkspace(
    snapshot({ vaultPages: [note({ title: "Method Notes" })] }),
  );
  const parsed = parseWorkspaceFolder(files);
  // The extra key is ignored on the way in: identity is still the id.
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.id, "n1");
  assert.equal(parsed[0]!.type, "vault_page");
});

// ---------------------------------------------------------------------- tags

test("tags with spaces are hyphenated, because a space ends a tag elsewhere", () => {
  assert.deepEqual(obsidianTags(["machine learning", "nlp"]), ["machine-learning", "nlp"]);
});

test("hyphenating can collide, and the collision is deduped", () => {
  assert.deepEqual(obsidianTags(["deep learning", "deep-learning"]), ["deep-learning"]);
});

test("no tags means no key, not an empty list", () => {
  assert.equal(obsidianTags([]), undefined);
  assert.equal(obsidianTags(undefined), undefined);
});

test("a paper's tags reach the file in their safe form", () => {
  const { files } = serializeWorkspace(
    snapshot({ papers: [paper({ tags: ["machine learning"] })] }),
  );
  const [path] = Object.keys(files);
  assert.deepEqual(readFrontmatter(files[path!]!).frontmatter.tags, ["machine-learning"]);
});

// ------------------------------------------------------- reading foreign YAML

test("a block list is read, because that is how other editors write lists", () => {
  const { frontmatter, body } = readFrontmatter(
    ["---", "title: Method", "tags:", "  - alpha", "  - beta", "---", "Body."].join("\n"),
  );
  assert.deepEqual(frontmatter.tags, ["alpha", "beta"]);
  assert.equal(frontmatter.title, "Method");
  assert.equal(body, "Body.");
});

test("quoted block items keep their punctuation", () => {
  const { frontmatter } = readFrontmatter(
    ["---", "aliases:", '  - "Method, revised"', "  - 'Method v2'", "---", ""].join("\n"),
  );
  assert.deepEqual(frontmatter.aliases, ["Method, revised", "Method v2"]);
});

test("a single-quoted scalar unquotes, doubled quote and all", () => {
  const { frontmatter } = readFrontmatter(["---", "title: 'It''s here'", "---", ""].join("\n"));
  assert.equal(frontmatter.title, "It's here");
});

test("a nested map leaves no key rather than an empty one", () => {
  const { frontmatter } = readFrontmatter(
    ["---", "title: Method", "cssclasses:", "  wide: true", "---", ""].join("\n"),
  );
  assert.equal("cssclasses" in frontmatter, false);
  assert.equal(frontmatter.title, "Method");
});

test("a key after a block list is still read", () => {
  const { frontmatter } = readFrontmatter(
    ["---", "tags:", "  - alpha", "weaveforge-id: n1", "---", ""].join("\n"),
  );
  assert.equal(frontmatter["weaveforge-id"], "n1");
  assert.deepEqual(frontmatter.tags, ["alpha"]);
});

test("an inline list still wins over the block scan", () => {
  const { frontmatter } = readFrontmatter(["---", "tags: [alpha, beta]", "---", ""].join("\n"));
  assert.deepEqual(frontmatter.tags, ["alpha", "beta"]);
});

test("what we write still reads back byte-identically", () => {
  const source = writeFrontmatter({ "weaveforge-id": "n1", aliases: ["Method"] }, "Body.");
  const parsed = readFrontmatter(source);
  assert.deepEqual(parsed.frontmatter.aliases, ["Method"]);
  assert.equal(writeFrontmatter(parsed.frontmatter, parsed.body), source);
});
