import { before, test } from "node:test";
import assert from "node:assert/strict";
import {
  mirrorWorkspace as tsMirrorWorkspace,
  type WorkspaceSnapshot,
} from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
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
  const { served: _served, ...rs } = await mirrorWorkspace(core, input, rsFs, opts);
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
    base: first.mirrored,
  });
});

// Removal and held-back cases are not compared: sync no longer removes, and the legacy
// TS mirror still does, so the two diverge on purpose. The Rust tests pin that behaviour.

test("an unfetchable asset matches", async () => {
  const a = new MemoryWorkspaceFs(() => AT);
  const b = new MemoryWorkspaceFs(() => AT);
  await step(a, b, snapshot({ vaultPages: [note("n1", "Method", "![](vault:u1/n1/gone.png)")] }), {
    project: PROJECT,
    fetchAsset: fetchNothing,
  });
});
