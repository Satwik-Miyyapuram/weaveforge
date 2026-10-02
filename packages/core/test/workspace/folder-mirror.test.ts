import assert from "node:assert/strict";
import test from "node:test";
import { MemoryWorkspaceFs } from "../../src/testing/memory-workspace-fs.js";
import {
  NoOpWorkspaceGit,
  digestText,
  describeChanges,
  mirrorWorkspace,
  projectDir,
  type WorkspaceProject,
  type WorkspaceSnapshot,
} from "../../src/index.js";

function snapshot(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    papers: [], vaultPages: [], readingLists: [], readingListItems: [],
    reportSections: [], experiments: [], milestones: [], logEntries: [],
    relations: [], tags: [], collectedAt: "2026-08-05T00:00:00.000Z", ...over,
  };
}

const note = (id: string, title: string, body = "") =>
  ({ id, title, body, sortOrder: 0, createdAt: "", updatedAt: "" }) as never;

const THESIS: WorkspaceProject = { id: "8d731734-bdcd-4f08-b648-efd15fdf75da", name: "MSc Thesis" };
const ROOT = projectDir(THESIS);

/** Every mirrored file is inside the project's folder. */
const at = (path: string) => `${ROOT}/${path}`;

test("a first mirror writes the whole folder", async () => {
  const fs = new MemoryWorkspaceFs();
  const result = await mirrorWorkspace(snapshot({ vaultPages: [note("n1", "Method")] }), fs, {
    project: THESIS,
  });

  assert.ok(result.written.includes(at("notes/method.note.md")));
  assert.equal(result.unchanged, 0);
});

test("mirroring twice writes nothing the second time", async () => {
  const fs = new MemoryWorkspaceFs();
  const input = snapshot({ vaultPages: [note("n1", "Method", "Body")] });

  await mirrorWorkspace(input, fs, { project: THESIS });
  const second = await mirrorWorkspace(input, fs, { project: THESIS });

  // Determinism is what makes this possible, and it is what stops git filling
  // with commits full of untouched files.
  assert.deepEqual(second.written, []);
  assert.ok(second.unchanged > 0);
});

test("an edit rewrites only the file that changed", async () => {
  const fs = new MemoryWorkspaceFs();
  await mirrorWorkspace(
    snapshot({ vaultPages: [note("n1", "Method", "One"), note("n2", "Other", "Two")] }),
    fs,
    { project: THESIS },
  );

  const result = await mirrorWorkspace(
    snapshot({ vaultPages: [note("n1", "Method", "Edited"), note("n2", "Other", "Two")] }),
    fs,
    { project: THESIS },
  );

  assert.deepEqual(result.written, [at("notes/method.note.md")]);
});

test("a deleted entity's file is removed", async () => {
  const fs = new MemoryWorkspaceFs();
  const first = await mirrorWorkspace(
    snapshot({ vaultPages: [note("n1", "Method"), note("n2", "Gone")] }),
    fs,
    { project: THESIS },
  );

  const result = await mirrorWorkspace(snapshot({ vaultPages: [note("n1", "Method")] }), fs, {
    project: THESIS,
    previousPaths: first.written,
  });

  assert.ok(result.removed.includes(at("notes/gone.note.md")));
  assert.equal(await fs.stat(at("notes/gone.note.md")), null);
});

test("files the mirror does not own are left alone", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile(".obsidian/workspace.json", "{}");
  await fs.writeFile(at("notes/my-own-file.md"), "Written by hand.");

  const first = await mirrorWorkspace(snapshot({ vaultPages: [note("n1", "Method")] }), fs, {
    project: THESIS,
  });
  await mirrorWorkspace(snapshot(), fs, { project: THESIS, previousPaths: first.written });

  // Deleting unrecognised files in a folder the user can see would be an
  // unpleasant surprise the first time it happened.
  assert.ok(await fs.stat(".obsidian/workspace.json"));
  assert.ok(await fs.stat(at("notes/my-own-file.md")));
});

/**
 * The regression this whole change exists for.
 *
 * The mirror removes a file the manifest does not claim. There used to be one
 * manifest for the whole folder, so a run for a second project was handed the
 * first project's paths as its own, wrote its own files, and removed everything
 * else — papers, notes and the cached PDFs with them. Each project's manifest now
 * names only its own files, and this is what that buys.
 */
test("mirroring a second project leaves the first project's files alone", async () => {
  const fs = new MemoryWorkspaceFs();
  const offline: WorkspaceProject = { id: "00000000-0000-4000-8000-0000000000aa", name: "Offline Trial" };
  const offlineRoot = projectDir(offline);

  const first = await mirrorWorkspace(
    snapshot({ vaultPages: [note("n1", "Thesis method")] }),
    fs,
    { project: THESIS },
  );
  const thesisFile = at("notes/thesis-method.note.md");
  assert.ok(await fs.stat(thesisFile));

  // A run for the other project, with its own manifest — empty, because this is
  // its first run. Same folder, same filesystem.
  const second = await mirrorWorkspace(
    snapshot({ vaultPages: [note("n2", "Trial notes")] }),
    fs,
    { project: offline, previousPaths: [] },
  );

  assert.ok(await fs.stat(thesisFile), "the first project's note is still on disk");
  assert.ok(await fs.stat(`${offlineRoot}/notes/trial-notes.note.md`));
  // And it was not reported as removed, so no manifest claims it went away.
  assert.ok(!second.removed.includes(thesisFile));
  assert.ok(!first.written.includes(`${offlineRoot}/notes/trial-notes.note.md`));
});

test("each project's bookkeeping is its own", async () => {
  const fs = new MemoryWorkspaceFs();
  const offline: WorkspaceProject = { id: "00000000-0000-4000-8000-0000000000aa", name: "Offline Trial" };
  const offlineRoot = projectDir(offline);

  await mirrorWorkspace(
    snapshot({ relations: [{ id: "r1" } as never], tags: [{ id: "t1" } as never] }),
    fs,
    { project: THESIS },
  );
  await mirrorWorkspace(snapshot(), fs, { project: offline });

  const thesisRelations = await fs.readText(at(".weaveforge/relations.json"));
  const offlineRelations = await fs.readText(`${offlineRoot}/.weaveforge/relations.json`);

  assert.match(thesisRelations ?? "", /r1/, "the first project keeps its edges");
  assert.doesNotMatch(offlineRelations ?? "", /r1/, "and the second project does not inherit them");
});

test("assets are fetched once and not re-downloaded", async () => {
  const fs = new MemoryWorkspaceFs();
  let fetches = 0;
  const input = snapshot({
    vaultPages: [note("n1", "Method", "![](vault:u1/n1/a.png)")],
  });
  const fetchAsset = async () => {
    fetches += 1;
    return new Uint8Array([1, 2, 3]);
  };

  await mirrorWorkspace(input, fs, { project: THESIS, fetchAsset });
  await mirrorWorkspace(input, fs, { project: THESIS, fetchAsset });

  assert.equal(fetches, 1, "storage paths carry a uuid, so an existing asset is the same file");
  // Assets stay shared at the top of the folder: one tree, so a body's relative
  // links resolve from anywhere inside it.
  assert.ok(await fs.stat("assets/notes/u1/n1/a.png"));
});

test("a missing asset does not abort the mirror", async () => {
  const fs = new MemoryWorkspaceFs();
  const result = await mirrorWorkspace(
    snapshot({ vaultPages: [note("n1", "Method", "![](vault:u1/n1/gone.png)")] }),
    fs,
    { project: THESIS, fetchAsset: async () => null },
  );

  assert.ok(result.written.includes(at("notes/method.note.md")), "the note is still written");
});

test("git is off by default and answers without throwing", async () => {
  const git = new NoOpWorkspaceGit();

  assert.equal(git.kind, "none");
  assert.equal(await git.isRepo(), false);
  assert.equal(await git.commitAll(), null);
  assert.deepEqual(await git.log(), []);
  assert.equal(await git.readAt(), null);
});

test("commit messages describe what changed", () => {
  assert.equal(describeChanges([]), "No changes");
  assert.equal(
    describeChanges([
      { path: "a", state: "added" },
      { path: "b", state: "modified" },
      { path: "c", state: "modified" },
      { path: "d", state: "deleted" },
    ]),
    "1 added, 2 changed, 1 removed",
  );
});

/**
 * A file the reader edited belongs to the reader.
 *
 * The mirror used to write over any difference, so an edit made in the folder —
 * a sentence rewritten, an edge added by hand — was gone by the next sync,
 * before the import could ever offer to apply it.
 */
test("a file edited since the last mirror is left alone and reported", async () => {
  const fs = new MemoryWorkspaceFs();
  const first = await mirrorWorkspace(
    snapshot({ vaultPages: [note("n1", "Method", "One")] }),
    fs,
    { project: THESIS },
  );
  const path = at("notes/method.note.md");
  assert.ok(first.written.includes(path));

  // Somebody edits it in the folder.
  const edited = `${await fs.readText(path)}\nA sentence the reader added.\n`;
  await fs.writeFile(path, edited);

  const second = await mirrorWorkspace(
    snapshot({ vaultPages: [note("n1", "Method", "One changed in the app")] }),
    fs,
    { project: THESIS, previousPaths: first.written, base: first.mirrored },
  );

  assert.equal(await fs.readText(path), edited, "the folder's copy is untouched");
  assert.deepEqual(second.heldBack, [path]);
  assert.deepEqual(second.written, [], "and it is not reported as written");
  assert.deepEqual(second.removed, [], "nor as removed");
});

test("a file the mirror never wrote is still written beside, and nothing is held", async () => {
  const fs = new MemoryWorkspaceFs();
  // A note dropped in by hand: no base digest, so the mirror owns nothing here.
  await fs.writeFile(at("notes/dropped.note.md"), "typed straight into the folder");

  const result = await mirrorWorkspace(
    snapshot({ vaultPages: [note("n1", "Method", "One")] }),
    fs,
    { project: THESIS, base: {} },
  );

  assert.deepEqual(result.heldBack, []);
  assert.ok(await fs.stat(at("notes/dropped.note.md")), "the reader's file is left where it is");
  assert.ok(result.written.includes(at("notes/method.note.md")));
});

test("an edited file whose entity left the workspace is not deleted", async () => {
  const fs = new MemoryWorkspaceFs();
  const first = await mirrorWorkspace(
    snapshot({ vaultPages: [note("n1", "Method"), note("n2", "Gone")] }),
    fs,
    { project: THESIS },
  );
  const gone = at("notes/gone.note.md");
  const edited = `${await fs.readText(gone)}\nStill wanted.\n`;
  await fs.writeFile(gone, edited);

  // The note is deleted in the app; the folder's copy was edited first.
  const second = await mirrorWorkspace(snapshot({ vaultPages: [note("n1", "Method")] }), fs, {
    project: THESIS,
    previousPaths: first.written,
    base: first.mirrored,
  });

  assert.equal(await fs.readText(gone), edited, "a deletion does not take an edit with it");
  assert.deepEqual(second.heldBack, [gone]);
  assert.deepEqual(second.removed, []);
});

test("an edit the import has applied no longer holds the mirror back", async () => {
  const fs = new MemoryWorkspaceFs();
  const first = await mirrorWorkspace(
    snapshot({ vaultPages: [note("n1", "Method", "One")] }),
    fs,
    { project: THESIS },
  );
  const path = at("notes/method.note.md");
  await fs.writeFile(path, "the reader's version");

  // The import applies that edit: the workspace now holds what the folder holds.
  const applied = await mirrorWorkspace(
    snapshot({ vaultPages: [note("n1", "Method", "the reader's version")] }),
    fs,
    { project: THESIS, previousPaths: first.written, base: first.mirrored },
  );
  assert.deepEqual(applied.heldBack, [path], "held while the two sides disagree");

  // Applying an edit through the import records the folder's text as the base
  // (see `applyEntries`), which is what "the two sides agree" means here: the
  // digest is the one the file now has, not the one the app would have written.
  const agreedBase = { ...first.mirrored, [path]: digestText(await fs.readText(path)) };
  const agreed = await mirrorWorkspace(
    snapshot({ vaultPages: [note("n1", "Method", "the reader's version")] }),
    fs,
    { project: THESIS, previousPaths: first.written, base: agreedBase },
  );
  assert.deepEqual(agreed.heldBack, [], "nothing is held back once the edit has been applied");
  assert.ok(agreed.written.includes(path), "and the app's version is written normally again");
});

test("the same protection covers the project's JSON data files", async () => {
  const fs = new MemoryWorkspaceFs();
  const first = await mirrorWorkspace(
    snapshot({ relations: [{ id: "r1" } as never] }),
    fs,
    { project: THESIS },
  );
  const path = at(".weaveforge/relations.json");
  assert.ok(first.written.includes(path));

  // An edge added by hand, in the file the mirror writes.
  const edited = `${(await fs.readText(path)).trim()}\n`;
  await fs.writeFile(path, edited.replace("]", '  { "id": "r2" }\n]'));

  const second = await mirrorWorkspace(
    snapshot({ relations: [{ id: "r1" } as never] }),
    fs,
    { project: THESIS, previousPaths: first.written, base: first.mirrored },
  );

  assert.deepEqual(second.heldBack, [path]);
  assert.match((await fs.readText(path)) ?? "", /r2/, "the hand-added edge survives the sync");
});

test("the mirror never reaches into the ink sidecar", async () => {
  const fs = new MemoryWorkspaceFs();
  // A page of somebody's handwriting, written by the ink store rather than by
  // the mirror -- which is the whole reason this holds.
  const inkPath = ".ink/n1/01JCHUNK0000000000000000.inkb";
  await fs.mkdirp(".ink/n1");
  await fs.writeFile(inkPath, new Uint8Array([1, 2, 3]));

  const first = await mirrorWorkspace(snapshot({ vaultPages: [note("n1", "Method")] }), fs, {
    project: THESIS,
  });
  assert.deepEqual(first.written.filter((path) => path.startsWith(".ink/")), []);

  // The note goes; the strokes stay. A chunk is never in `previousPaths`, so a
  // mirror run cannot name it as one of its own departed files.
  const second = await mirrorWorkspace(snapshot(), fs, {
    project: THESIS,
    previousPaths: first.written,
  });
  assert.deepEqual(second.removed.filter((path) => path.startsWith(".ink/")), []);
  assert.ok(second.removed.includes(at("notes/method.note.md")));
  assert.notEqual(await fs.stat(inkPath), null);
});

test("the root README, rewritten by another project's mirror, is not held back", async () => {
  const fs = new MemoryWorkspaceFs();
  const other: WorkspaceProject = { id: "407c3746-13be-4230-bdfa-47c065d7c189", name: "Offline Trial" };
  const first = await mirrorWorkspace(snapshot(), fs, { project: THESIS });
  await mirrorWorkspace(snapshot({ collectedAt: "2026-08-06T00:00:00.000Z" }), fs, { project: other });

  const second = await mirrorWorkspace(snapshot({ collectedAt: "2026-08-07T00:00:00.000Z" }), fs, {
    project: THESIS,
    previousPaths: first.written,
    base: first.mirrored,
  });

  assert.deepEqual(second.heldBack, []);
  assert.match(await fs.readText("README.md"), /2026-08-07/);
});
