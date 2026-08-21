import assert from "node:assert/strict";
import test from "node:test";
import { MemoryWorkspaceFs } from "../../src/testing/memory-workspace-fs.js";
import {
  WORKSPACE_META_DIR,
  WorkspacePathError,
  diffWorkspace,
  flatPath,
  fromRelativeBlobLinks,
  isSafeWorkspacePath,
  logPath,
  parseWorkspaceFolder,
  readFrontmatter,
  safeWorkspacePath,
  serializeWorkspace,
  slugFor,
  toRelativeBlobLinks,
  treePaths,
  writeFrontmatter,
  type ExistingEntity,
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

// ------------------------------------------------------------------ paths

test("slugs are filesystem-safe and readable", () => {
  assert.equal(slugFor("Variational Autoencoders"), "variational-autoencoders");
  assert.equal(slugFor("Café / Résumé"), "cafe-resume");
  assert.equal(slugFor("   "), "untitled");
});

test("Windows reserved names get a suffix so the folder is portable", () => {
  // `con.md` cannot be created on Windows; a folder that fails to round-trip
  // on one platform is not portable.
  assert.equal(slugFor("CON"), "con-file");
  assert.equal(slugFor("aux"), "aux-file");
});

test("traversal is rejected, including Windows-style and absolute paths", () => {
  assert.throws(() => safeWorkspacePath("../../etc/passwd"), WorkspacePathError);
  assert.throws(() => safeWorkspacePath("..\\..\\etc"), WorkspacePathError);
  assert.throws(() => safeWorkspacePath("/etc/passwd"), WorkspacePathError);
  assert.throws(() => safeWorkspacePath("C:/Windows"), WorkspacePathError);
  assert.equal(safeWorkspacePath("./notes/a.md"), "notes/a.md");
  assert.equal(isSafeWorkspacePath("notes/../../x"), false);
});

test("a note with children becomes a folder note", () => {
  const paths = treePaths(
    [
      { id: "root", title: "Method" },
      { id: "child", title: "Baselines", parentId: "root" },
    ],
    "notes",
  );

  assert.equal(paths.get("root"), "notes/method/method.md");
  assert.equal(paths.get("child"), "notes/method/baselines.md");
});

test("slug collisions inside one directory are broken by id", () => {
  const paths = treePaths(
    [{ id: "a1", title: "Notes" }, { id: "b2", title: "Notes" }],
    "notes",
  );

  assert.notEqual(paths.get("a1"), paths.get("b2"));
});

test("a cyclic parent chain does not hang the layout", () => {
  const paths = treePaths(
    [{ id: "a", title: "A", parentId: "b" }, { id: "b", title: "B", parentId: "a" }],
    "notes",
  );

  assert.equal(paths.size, 2);
});

test("logbook is dated into year/month folders", () => {
  assert.match(logPath("l1", "2026-03-14"), /^logbook\/2026\/03\/2026-03-14--/);
});

// ------------------------------------------------------------ frontmatter

test("frontmatter round-trips scalars and lists", () => {
  const text = writeFrontmatter(
    { "weaveforge-id": "n1", title: "A, B", tags: ["x", "y"], year: 2017, done: true },
    "Body",
  );
  const parsed = readFrontmatter(text);

  assert.equal(parsed.frontmatter["weaveforge-id"], "n1");
  assert.equal(parsed.frontmatter.title, "A, B");
  assert.deepEqual(parsed.frontmatter.tags, ["x", "y"]);
  assert.equal(parsed.frontmatter.year, 2017);
  assert.equal(parsed.frontmatter.done, true);
  assert.equal(parsed.body.trim(), "Body");
});

test("a file with no frontmatter is all body, not an error", () => {
  const parsed = readFrontmatter("Just prose.");

  assert.deepEqual(parsed.frontmatter, {});
  assert.equal(parsed.body, "Just prose.");
});

test("empty lists and undefined fields are omitted rather than emitted empty", () => {
  const text = writeFrontmatter({ a: "x", b: undefined, c: [] }, "");

  assert.match(text, /a: x/);
  assert.doesNotMatch(text, /b:/);
  assert.doesNotMatch(text, /c:/);
});

// ------------------------------------------------------------- blob links

test("blob refs become folder-relative so the folder renders in Obsidian", () => {
  const { body, assets } = toRelativeBlobLinks(
    "![](vault:user-1/n1/diagram.png)",
    "notes/method/baselines.md",
  );

  assert.match(body, /!\[\]\(\.\.\/\.\.\/assets\/notes\/user-1\/n1\/diagram\.png\)/);
  assert.equal(assets[0]!.storagePath, "user-1/n1/diagram.png");
});

test("import re-anchors assets and never trusts a written storage path", () => {
  const body = "![](../assets/notes/other-user/n9/secret.png)";

  // The resolver only knows files that were in the archive; anything else is
  // left as written rather than turned into a storage path that could point at
  // another user's object.
  const unresolved = fromRelativeBlobLinks(body, { resolve: () => null });
  assert.equal(unresolved, body, "an unknown asset must not become a storage ref");

  const reanchored = fromRelativeBlobLinks(body, { resolve: () => "me/n9/secret.png" });
  assert.equal(reanchored, "![](vault:me/n9/secret.png)");
});

// -------------------------------------------------------------- round trip

test("serialize → parse preserves id, type, title, and body", () => {
  const files = serializeWorkspace(
    snapshot({
      vaultPages: [note(), note({ id: "n2", title: "Baselines", parentId: "n1", body: "Second." })],
      papers: [
        {
          id: "p1", title: "Attention", authors: ["Vaswani"], year: 2017, tags: ["nlp"],
          abstract: "Abstract text.", summary: "My notes.",
          createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
        } as never,
      ],
      logEntries: [
        { id: "l1", entryDate: "2026-03-14", kind: "daily", body: "Ran it.", links: [], createdAt: "2026-03-14T00:00:00.000Z" } as never,
      ],
    }),
  ).files;

  const parsed = parseWorkspaceFolder(files);
  const byId = new Map(parsed.map((entity) => [entity.id, entity]));

  assert.equal(parsed.length, 4);
  assert.equal(byId.get("n1")!.type, "vault_page");
  assert.equal(byId.get("n1")!.title, "Method");
  assert.match(byId.get("n1")!.body, /Body text/);
  assert.equal(byId.get("p1")!.type, "paper");
  assert.match(byId.get("p1")!.body, /Abstract text/);
  assert.equal(byId.get("l1")!.type, "log_entry");
});

test("serializing twice is byte-identical, so git diffs stay meaningful", () => {
  const input = snapshot({ vaultPages: [note(), note({ id: "n2", title: "Other" })] });

  assert.deepEqual(serializeWorkspace(input).files, serializeWorkspace(input).files);
});

test("metadata and README are written but are not entities", () => {
  const files = serializeWorkspace(snapshot({ vaultPages: [note()] })).files;

  assert.ok(files[`${WORKSPACE_META_DIR}/manifest.json`]);
  assert.ok(files["README.md"]);
  assert.equal(parseWorkspaceFolder(files).length, 1, "only the note is an entity");
});

test("the folder can be written to a filesystem and read back", async () => {
  const fs = new MemoryWorkspaceFs(() => "2026-08-05T00:00:00.000Z");
  const { files } = serializeWorkspace(snapshot({ vaultPages: [note()] }));
  for (const [path, content] of Object.entries(files)) await fs.writeFile(path, content);

  const seen: string[] = [];
  for await (const entry of fs.walk("notes")) seen.push(entry.path);

  assert.deepEqual(seen, ["notes/method.md"]);
  assert.match(await fs.readText("notes/method.md"), /weaveforge-id: n1/);
});

// -------------------------------------------------------------------- diff

const existing = (over: Partial<ExistingEntity> = {}): ExistingEntity => ({
  id: "n1", type: "vault_page", title: "Method", body: "Body text.", ...over,
});

function parsedFrom(snap: WorkspaceSnapshot) {
  return parseWorkspaceFolder(serializeWorkspace(snap).files);
}

test("an unchanged folder reports no writes", () => {
  const diff = diffWorkspace(parsedFrom(snapshot({ vaultPages: [note()] })), [existing()]);

  assert.equal(diff.counts.unchanged, 1);
  assert.equal(diff.counts.updated, 0);
});

test("an edited body is an update", () => {
  const diff = diffWorkspace(
    parsedFrom(snapshot({ vaultPages: [note({ body: "Edited." })] })),
    [existing()],
  );

  assert.equal(diff.counts.updated, 1);
});

test("an unknown id is a creation, not an overwrite", () => {
  const diff = diffWorkspace(parsedFrom(snapshot({ vaultPages: [note({ id: "elsewhere" })] })), []);

  assert.equal(diff.counts.created, 1);
});

test("a file with no id imports as new rather than being rejected", () => {
  const parsed = parseWorkspaceFolder({ "notes/hand-written.md": "Typed straight into the folder." });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.id, undefined);
  assert.equal(diffWorkspace(parsed, []).counts.created, 1);
});

test("an id claiming a different entity type is a conflict, never a write", () => {
  // The attack this blocks: a crafted file naming an existing note's id but
  // declaring itself a paper, to overwrite that note on import.
  const parsed = parseWorkspaceFolder(
    serializeWorkspace(
      snapshot({
        papers: [
          { id: "n1", title: "Impostor", authors: [], tags: [], createdAt: "", updatedAt: "" } as never,
        ],
      }),
    ).files,
  );

  const diff = diffWorkspace(parsed, [existing()]);

  assert.equal(diff.counts.conflict, 1);
  assert.equal(diff.counts.updated, 0);
  assert.match(diff.entries[0]!.reason ?? "", /belongs to a vault_page/);
});

test("the diff never reports an action it cannot justify", () => {
  const diff = diffWorkspace(parsedFrom(snapshot({ vaultPages: [note()] })), [existing()]);
  const total = Object.values(diff.counts).reduce((sum, n) => sum + n, 0);

  assert.equal(total, diff.entries.length);
});
