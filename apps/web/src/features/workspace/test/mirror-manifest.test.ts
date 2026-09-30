import assert from "node:assert/strict";
import { test } from "node:test";

import { digestText, projectDir } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@weaveforge/core/testing";

import {
  MIRROR_MANIFEST_PATH,
  jsonEditSince,
  mirrorManifestPath,
  baseDigest,
  claimImportedFile,
  createCoalescer,
  nextManifest,
  readMirrorBase,
  writeMirrorManifest,
} from "../application/mirror-manifest";

/**
 * Two projects, because a manifest belongs to one.
 *
 * `ROOT` is the project these tests mirror; `OTHER_ROOT` exists only to be asked
 * what *it* has written and must never answer with the first one's files.
 */
const PROJECT = { id: "8d731734-bdcd-4f08-b648-efd15fdf75da", name: "MSc Thesis" };
const OTHER = { id: "00000000-0000-4000-8000-0000000000aa", name: "Offline Trial" };
const ROOT = projectDir(PROJECT);
const OTHER_ROOT = projectDir(OTHER);

/** The paths a project's manifest claims, in order. */
async function manifestPaths(fs: MemoryWorkspaceFs, root = ROOT): Promise<string[]> {
  return Object.keys(await readMirrorBase(fs, root)).sort();
}

test("a manifest round trips, sorted and deduplicated", async () => {
  const fs = new MemoryWorkspaceFs();
  await writeMirrorManifest(fs, ROOT, ["b.md", "a.md", "b.md"]);
  assert.deepEqual(await manifestPaths(fs), ["a.md", "b.md"]);
});

test("the base digests round trip with the paths", async () => {
  const fs = new MemoryWorkspaceFs();
  await writeMirrorManifest(fs, ROOT, ["a.md", "b.md"], { "a.md": "d1", "b.md": "d2" });
  assert.deepEqual(await readMirrorBase(fs, ROOT), { "a.md": "d1", "b.md": "d2" });
});

test("a digest for a path that left is not carried forward", async () => {
  const fs = new MemoryWorkspaceFs();
  // The mirror reports a digest for every file it serialized, including ones
  // this run no longer claims; storing those would grow the manifest forever.
  await writeMirrorManifest(fs, ROOT, ["a.md"], { "a.md": "d1", "gone.md": "d2" });
  assert.deepEqual(await readMirrorBase(fs, ROOT), { "a.md": "d1" });
});

test("a version 1 manifest keeps its paths and offers no base", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.mkdirp(MIRROR_MANIFEST_PATH.split("/").slice(0, -1).join("/"));
  await fs.writeFile(MIRROR_MANIFEST_PATH, JSON.stringify({ version: 1, paths: ["a.md"] }));
  assert.deepEqual(await manifestPaths(fs), ["a.md"]);
  // Empty rather than absent: the path is still ours to remove, but nothing is
  // known about what it said when the two sides last agreed.
  assert.deepEqual(await readMirrorBase(fs, ROOT), { "a.md": "" });
});

test("an absent manifest reads as remove-nothing rather than throwing", async () => {
  assert.deepEqual(await manifestPaths(new MemoryWorkspaceFs()), []);
});

test("a truncated or foreign manifest also removes nothing", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.mkdirp(MIRROR_MANIFEST_PATH.split("/")[0]!);

  await fs.writeFile(MIRROR_MANIFEST_PATH, '{"paths": ["a.md"');
  assert.deepEqual(await manifestPaths(fs), []);

  // Valid JSON, wrong shape — something else's file living at our path.
  await fs.writeFile(MIRROR_MANIFEST_PATH, '{"files": ["a.md"]}');
  assert.deepEqual(await manifestPaths(fs), []);
});

test("non-string entries are dropped rather than trusted", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.mkdirp(MIRROR_MANIFEST_PATH.split("/")[0]!);
  await fs.writeFile(MIRROR_MANIFEST_PATH, '{"paths": ["a.md", 7, null, "b.md"]}');
  assert.deepEqual(await manifestPaths(fs), ["a.md", "b.md"]);
});

test("the next manifest keeps what stayed, drops what left, adds what was written", () => {
  assert.deepEqual(
    nextManifest(["kept.md", "gone.md"], { written: ["new.md"], removed: ["gone.md"] }).sort(),
    ["kept.md", "new.md"],
  );
});

test("a file rewritten in place is not listed twice", () => {
  assert.deepEqual(nextManifest(["a.md"], { written: ["a.md"], removed: [] }), ["a.md"]);
});

/** A coalescer whose clock this test owns. */
function harness(run: () => Promise<unknown>, onError?: (error: unknown) => void) {
  const timers: (() => void)[] = [];
  const coalescer = createCoalescer({
    run,
    debounceMs: 5,
    ...(onError ? { onError } : {}),
    setTimeoutFn: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeoutFn: () => timers.pop(),
  });
  return { coalescer, fire: () => timers.splice(0).forEach((fire) => fire()) };
}

test("a burst of requests is one run", async () => {
  let runs = 0;
  const { coalescer, fire } = harness(async () => {
    runs += 1;
  });

  coalescer.request();
  coalescer.request();
  coalescer.request();
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);
});

test("a request landing mid-run is honoured afterwards", async () => {
  let runs = 0;
  const gate: { release?: () => void } = {};
  const { coalescer, fire } = harness(async () => {
    runs += 1;
    if (runs === 1) {
      await new Promise<void>((resolve) => {
        gate.release = resolve;
      });
    }
  });

  coalescer.request();
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);

  // Second request arrives while the first run is still going.
  coalescer.request();
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1, "the second run should wait rather than overlap");

  gate.release?.();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 2);
});

test("a suspended coalescer stands down", async () => {
  let runs = 0;
  const { coalescer, fire } = harness(async () => {
    runs += 1;
  });

  coalescer.suspended = true;
  coalescer.request();
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 0);

  coalescer.suspended = false;
  coalescer.request();
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);
});

test("cancelling drops a pending request", async () => {
  let runs = 0;
  const { coalescer, fire } = harness(async () => {
    runs += 1;
  });

  coalescer.request();
  coalescer.cancel();
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 0);
});

test("a failing run is reported, not thrown", async () => {
  const seen: unknown[] = [];
  const { coalescer, fire } = harness(async () => {
    throw new Error("disk unplugged");
  }, (error) => seen.push(error));

  coalescer.request();
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen.length, 1);

  // And the coalescer is still usable afterwards.
  coalescer.request();
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen.length, 2);
});

test("a hand-written file is stamped with the id it was imported as", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/My idea.md", "---\ntitle: My idea\n---\n\nthe body\n");
  await writeMirrorManifest(fs, ROOT, ["notes/old.note.md"], { "notes/old.note.md": "d0" });

  assert.equal(await claimImportedFile(fs, "notes/My idea.md", "n1", ROOT), true);

  const stamped = await fs.readText("notes/My idea.md");
  assert.match(stamped, /^---\nweaveforge-id: n1\n/);
  // Claimed, so the next mirror removes it once the entity is written out
  // under its own name — instead of leaving the folder holding both copies.
  const base = await readMirrorBase(fs, ROOT);
  assert.deepEqual(Object.keys(base).sort(), ["notes/My idea.md", "notes/old.note.md"]);
  assert.equal(base["notes/My idea.md"], baseDigest(stamped));
  assert.equal(base["notes/old.note.md"], "d0");
});

test("a file that already carries an id is neither rewritten nor claimed", async () => {
  const fs = new MemoryWorkspaceFs();
  const content = "---\nweaveforge-id: n9\n---\n\nbody\n";
  await fs.writeFile("notes/theirs.md", content);

  assert.equal(await claimImportedFile(fs, "notes/theirs.md", "n1", ROOT), false);
  assert.equal(await fs.readText("notes/theirs.md"), content);
  assert.deepEqual(await readMirrorBase(fs, ROOT), {});
});

test("a file that has gone since the preview is not an error", async () => {
  const fs = new MemoryWorkspaceFs();
  assert.equal(await claimImportedFile(fs, "notes/gone.md", "n1", ROOT), false);
});

test("a project's manifest says nothing about another project", async () => {
  const fs = new MemoryWorkspaceFs();
  await writeMirrorManifest(fs, ROOT, ["notes/thesis.note.md"]);

  // The other project has never mirrored anything, and the first project's file
  // is not a path it may remove.
  assert.deepEqual(await readMirrorBase(fs, OTHER_ROOT), {});
  assert.deepEqual(await manifestPaths(fs, OTHER_ROOT), []);
});

test("each project writes its manifest beside its own files", async () => {
  const fs = new MemoryWorkspaceFs();
  await writeMirrorManifest(fs, ROOT, ["notes/a.note.md"]);

  assert.ok(await fs.stat(`${ROOT}/.weaveforge/mirror.json`));
  assert.equal(await fs.stat(MIRROR_MANIFEST_PATH), null, "and never at the root");
});

test("the flat manifest is read once by a project that has none, then ignored", async () => {
  const fs = new MemoryWorkspaceFs();
  // What the layout before this wrote: one manifest at the root, naming every
  // file the flat folders held.
  await fs.mkdirp(MIRROR_MANIFEST_PATH.split("/").slice(0, -1).join("/"));
  await fs.writeFile(
    MIRROR_MANIFEST_PATH,
    JSON.stringify({ version: 3, paths: ["notes/flat.note.md"], digests: { "notes/flat.note.md": "d1" } }),
  );

  // The migration run sees them, which is what lets it remove the flat originals
  // as it writes their project-scoped replacements.
  assert.deepEqual(await manifestPaths(fs), ["notes/flat.note.md"]);
  assert.equal(mirrorManifestPath(ROOT), `${ROOT}/.weaveforge/mirror.json`);

  // Once the project has a manifest of its own, the flat one is out of the
  // picture — never merged, or a path both claimed would be counted twice.
  await writeMirrorManifest(fs, ROOT, [`${ROOT}/notes/thesis.note.md`]);
  assert.deepEqual(await manifestPaths(fs), [`${ROOT}/notes/thesis.note.md`]);
});

/**
 * The rule that keeps the mirror from reporting itself.
 *
 * The three JSON data files are rewritten whenever the data changes, so the
 * folder watcher would otherwise report the app's own write as an outside edit
 * on every save — and the reader would be asked to import what they just did.
 */
test("a JSON data file is somebody's edit unless it still holds what the app wrote", () => {
  const path = "msc-thesis--8d7317/.weaveforge/relations.json";
  const written = '[]\n';

  // The manifest's digest is what the app wrote: the file matching it is the
  // app's own write, and is not news.
  assert.equal(jsonEditSince({ [path]: digestText(written) }, path, written), false);

  // A file that has moved on since is an edit, and so is a file with no record
  // at all — a hand-made one, or one an older layout wrote.
  assert.equal(jsonEditSince({ [path]: digestText(written) }, path, '[{"id":"r1"}]'), true);
  assert.equal(jsonEditSince({}, path, written), true);
});
