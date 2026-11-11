import { before, test } from "node:test";
import assert from "node:assert/strict";
import {
  mirrorWorkspace as tsMirrorWorkspace,
  type WorkspaceSnapshot,
} from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@weaveforge/core/testing";
import type { RustCore } from "@/lib/rust-core";
import { mirrorWorkspace } from "@/features/workspace/application/parts-2";
import { loadTestCore } from "./load-test-core";

// The web's mirror (Rust plan, JS I/O) must leave the same result and the same folder as the TS one.

let core: RustCore;
before(async () => {
  core = await loadTestCore();
});

const PROJECT = { id: "8d731734-bdcd-4f08-b648-efd15fdf75da", name: "MSc Thesis" };
const AT = "2026-08-05T00:00:00.000Z";

type Opts = Parameters<typeof tsMirrorWorkspace>[2];

const at = (rel: string) => `${core.projectDir(PROJECT)}/${rel}`;

const snapshot = (over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot => ({
  papers: [], vaultPages: [], readingLists: [], readingListItems: [],
  reportSections: [], experiments: [], milestones: [], logEntries: [],
  relations: [], tags: [], readerAnnotations: [], collectedAt: AT, ...over,
});

const note = (id: string, title: string, body = "") =>
  ({ id, title, body, sortOrder: 0, createdAt: "", updatedAt: "" }) as never;

async function dump(fs: MemoryWorkspaceFs): Promise<Record<string, string>> {
  return fs.toRecord();
}

/** Runs both mirrors with the same input and asserts the result and the folder match. */
async function step(tsFs: MemoryWorkspaceFs, rsFs: MemoryWorkspaceFs, input: WorkspaceSnapshot, opts: Opts) {
  const ts = await tsMirrorWorkspace(input, tsFs, opts);
  const rs = await mirrorWorkspace(core, input, rsFs, opts);
  assert.deepEqual(rs, ts);
  assert.deepEqual(await dump(rsFs), await dump(tsFs));
  return ts;
}

/** Appends the same reader line to a file on both folders. */
async function editOnBoth(a: MemoryWorkspaceFs, b: MemoryWorkspaceFs, path: string) {
  for (const fs of [a, b]) {
    await fs.writeFile(path, (await fs.readText(path)) + "\nA reader's line.\n");
  }
}

const fetchAsset = async () => new Uint8Array([1, 2, 3]);
const fetchNothing = async () => null;

test("a fresh mirror matches the TS copy", async () => {
  const a = new MemoryWorkspaceFs(() => AT);
  const b = new MemoryWorkspaceFs(() => AT);
  await step(a, b, snapshot({ vaultPages: [note("n1", "Method", "One"), note("n2", "Results", "Two")] }), {
    project: PROJECT,
  });
});

test("a second run with nothing new matches", async () => {
  const a = new MemoryWorkspaceFs(() => AT);
  const b = new MemoryWorkspaceFs(() => AT);
  const input = snapshot({ vaultPages: [note("n1", "Method", "One"), note("n2", "Results", "Two")] });
  const first = await step(a, b, input, { project: PROJECT });
  await step(a, b, input, {
    project: PROJECT,
    previousPaths: Object.keys(first.mirrored),
    base: first.mirrored,
  });
});

test("a new export time alone matches", async () => {
  const a = new MemoryWorkspaceFs(() => AT);
  const b = new MemoryWorkspaceFs(() => AT);
  const input = snapshot({ vaultPages: [note("n1", "Method", "One")] });
  const first = await step(a, b, input, { project: PROJECT });
  await step(a, b, { ...input, collectedAt: "2026-09-01T00:00:00.000Z" }, {
    project: PROJECT,
    previousPaths: Object.keys(first.mirrored),
    base: first.mirrored,
  });
});

test("a reader's edit is held back the same way", async () => {
  const a = new MemoryWorkspaceFs(() => AT);
  const b = new MemoryWorkspaceFs(() => AT);
  const first = await step(a, b, snapshot({ vaultPages: [note("n1", "Method", "One")] }), { project: PROJECT });
  const notePath = Object.keys(first.mirrored).find((p) => p.endsWith("/notes/method.note.md"));
  assert.ok(notePath, "note path");
  await editOnBoth(a, b, notePath);

  const second = await step(a, b, snapshot({ vaultPages: [note("n1", "Method", "One changed in the app")] }), {
    project: PROJECT,
    previousPaths: Object.keys(first.mirrored),
    base: first.mirrored,
  });
  assert.equal(second.heldBack.length, 1);
});

test("departed files are removed or held the same way", async () => {
  const a = new MemoryWorkspaceFs(() => AT);
  const b = new MemoryWorkspaceFs(() => AT);
  const first = await step(
    a,
    b,
    snapshot({ vaultPages: [note("n1", "Method", "One"), note("n2", "Results", "Two"), note("n3", "Third", "Three")] }),
    { project: PROJECT },
  );
  await editOnBoth(a, b, at("notes/third.note.md"));

  const second = await step(a, b, snapshot({ vaultPages: [note("n1", "Method", "One")] }), {
    project: PROJECT,
    previousPaths: Object.keys(first.mirrored),
    base: first.mirrored,
  });
  assert.ok(second.removed.includes(at("notes/results.note.md")));
  assert.ok(second.heldBack.includes(at("notes/third.note.md")));
});

test("a departed file without a base is removed the same way", async () => {
  const a = new MemoryWorkspaceFs(() => AT);
  const b = new MemoryWorkspaceFs(() => AT);
  const first = await step(
    a,
    b,
    snapshot({ vaultPages: [note("n1", "Method", "One"), note("n2", "Results", "Two")] }),
    { project: PROJECT },
  );
  await step(a, b, snapshot({ vaultPages: [note("n1", "Method", "One")] }), {
    project: PROJECT,
    previousPaths: first.written,
  });
});

test("assets are fetched and kept the same way", async () => {
  const a = new MemoryWorkspaceFs(() => AT);
  const b = new MemoryWorkspaceFs(() => AT);
  const withImage = snapshot({ vaultPages: [note("n1", "Method", "![](vault:u1/n1/a.png)")] });
  const first = await step(a, b, withImage, { project: PROJECT, fetchAsset });
  const second = await step(a, b, withImage, {
    project: PROJECT,
    fetchAsset,
    previousPaths: first.written,
    base: first.mirrored,
  });
  await step(a, b, snapshot({ vaultPages: [note("n1", "Method", "No image")] }), {
    project: PROJECT,
    fetchAsset: fetchNothing,
    previousPaths: [...new Set([...second.written, ...first.written])],
    base: first.mirrored,
  });
});

test("an unfetchable asset matches", async () => {
  const a = new MemoryWorkspaceFs(() => AT);
  const b = new MemoryWorkspaceFs(() => AT);
  await step(a, b, snapshot({ vaultPages: [note("n1", "Method", "![](vault:u1/n1/gone.png)")] }), {
    project: PROJECT,
    fetchAsset: fetchNothing,
  });
});
