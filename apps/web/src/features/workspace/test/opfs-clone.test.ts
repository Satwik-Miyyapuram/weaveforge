/**
 * The web app's clone of the workspace repo in OPFS (D-1a): the whole tree,
 * each file's bytes fetched on first open, pushed without force, and a push
 * that loses the race keeps the remote file and saves the web text beside it.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { before, test } from "node:test";

import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import fc from "fast-check";

import { loadTestCore } from "@/lib/test/load-test-core";

import {
  type FileChange,
  type GitRemote,
  gitBlobSha,
  type RemoteHead,
  WebClone,
  WEB_CLONE_MANIFEST,
} from "../infrastructure/opfs-clone";

before(async () => {
  await loadTestCore();
});

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const sha1 = (bytes: Uint8Array) =>
  createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");

/** A GitHub repo in memory: one branch, fast-forward-only updates. */
class FakeRemote implements GitRemote {
  head_ = "c0";
  files = new Map<string, Uint8Array>();
  commits: Array<{ parent: string; changes: string[] }> = [];
  blobsFetched = 0;
  down = false;
  private n = 0;

  constructor(initial: Record<string, string>) {
    for (const [path, text] of Object.entries(initial)) this.files.set(path, enc(text));
  }
  private up() {
    if (this.down) throw new TypeError("Failed to fetch");
  }
  /** Someone else pushes (the desktop). */
  push(changes: Record<string, string | null>) {
    for (const [path, text] of Object.entries(changes)) {
      if (text === null) this.files.delete(path);
      else this.files.set(path, enc(text));
    }
    this.head_ = `c${++this.n}`;
  }
  text(path: string) {
    const bytes = this.files.get(path);
    return bytes ? dec(bytes) : null;
  }
  async head(): Promise<RemoteHead> {
    this.up();
    return {
      commit: this.head_,
      files: [...this.files].map(([path, bytes]) => ({ path, sha: sha1(bytes) })),
    };
  }
  async blob(sha: string): Promise<Uint8Array> {
    this.up();
    this.blobsFetched++;
    for (const bytes of this.files.values()) if (sha1(bytes) === sha) return bytes;
    throw new Error(`no blob ${sha}`);
  }
  async commit(parent: string, changes: readonly FileChange[]) {
    this.up();
    if (parent !== this.head_) return { kind: "behind" as const };
    this.commits.push({ parent, changes: changes.map((c) => c.path) });
    this.push(Object.fromEntries(changes.map((c) => [c.path, c.bytes ? dec(c.bytes) : null])));
    return { kind: "pushed" as const, commit: this.head_ };
  }
}

function setup(initial: Record<string, string>, shared: string[] = []) {
  const remote = new FakeRemote(initial);
  const fs = new MemoryWorkspaceFs();
  let lease = false;
  let clock = Date.UTC(2026, 10, 20, 10, 12, 0);
  const clone = new WebClone(fs, remote, {
    isShared: (path) => shared.includes(path),
    leaseHeld: () => lease,
    now: () => clock++,
  });
  return { remote, fs, clone, setLease: (held: boolean) => (lease = held) };
}

async function localFiles(fs: MemoryWorkspaceFs): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for await (const entry of fs.walk("")) {
    if (entry.kind !== "file" || entry.path.startsWith(".weaveforge/local/")) continue;
    out[entry.path] = await fs.readText(entry.path);
  }
  return out;
}

test("git blob ids match git's", async () => {
  for (const text of ["", "hello\n", "ünïcode ✓"]) {
    assert.equal(await gitBlobSha(enc(text)), sha1(enc(text)));
  }
});

test("shallow_clone_lazy_blob: cloning fetches no file bytes; opening one fetches it once", async () => {
  const { remote, clone } = setup({ "p/a.md": "A", "p/b.md": "B" });
  await clone.clone();
  assert.equal(remote.blobsFetched, 0);
  assert.deepEqual(await clone.paths(), ["p/a.md", "p/b.md"]);
  assert.equal(dec(await clone.read("p/a.md")), "A");
  assert.equal(dec(await clone.read("p/a.md")), "A");
  assert.equal(remote.blobsFetched, 1);
  assert.equal(await clone.unpushed(), 0);
});

test("clone_edit_commit_push: an edit is counted, pushed, and lands on the remote", async () => {
  const { remote, fs, clone } = setup({ "p/a.md": "A", "p/b.md": "B" });
  await clone.clone();
  await clone.read("p/a.md");
  await fs.writeFile("p/a.md", "A2");
  await fs.writeFile("p/new.md", "N");
  assert.equal(await clone.unpushed(), 2);
  const result = await clone.sync("web edits");
  assert.deepEqual(result.conflicts, []);
  assert.equal(remote.text("p/a.md"), "A2");
  assert.equal(remote.text("p/new.md"), "N");
  assert.equal(remote.text("p/b.md"), "B");
  assert.equal(await clone.unpushed(), 0);
});

test("a file deleted on the web is deleted on the remote; an unopened one is not", async () => {
  const { remote, fs, clone } = setup({ "a.md": "A", "b.md": "B" });
  await clone.clone();
  await clone.read("a.md");
  await fs.remove("a.md");
  await clone.sync("delete");
  assert.equal(remote.text("a.md"), null);
  assert.equal(remote.text("b.md"), "B");
});

test("removing an unopened file through the clone deletes it on the remote", async () => {
  const { remote, clone } = setup({ "a.md": "A", "b.md": "B" });
  await clone.clone();
  await clone.remove("b.md");
  assert.equal(await clone.unpushed(), 1);
  await clone.sync("delete");
  assert.equal(remote.text("b.md"), null);
  assert.equal(remote.blobsFetched, 0);
});

test("a pull brings remote edits; an unopened file stays unfetched", async () => {
  const { remote, fs, clone } = setup({ "a.md": "A", "b.md": "B" });
  await clone.clone();
  await clone.read("a.md");
  remote.push({ "a.md": "A2", "b.md": "B2", "c.md": "C" });
  const before = remote.blobsFetched;
  await clone.pull();
  assert.equal(await fs.readText("a.md"), "A2");
  assert.equal(await fs.stat("b.md"), null);
  assert.equal(remote.blobsFetched, before + 1);
  assert.equal(dec(await clone.read("b.md")), "B2");
  assert.deepEqual(await clone.paths(), ["a.md", "b.md", "c.md"]);
});

test("web_skips_shared_item_files: without the lease a shared file stays out of the commit", async () => {
  const { remote, fs, clone, setLease } = setup({ "s.md": "S", "a.md": "A" }, ["s.md"]);
  await clone.clone();
  await fs.writeFile("s.md", "S2");
  await fs.writeFile("a.md", "A2");
  await clone.sync("edits");
  assert.equal(remote.text("s.md"), "S");
  assert.equal(remote.text("a.md"), "A2");
  assert.deepEqual(remote.commits.at(-1)!.changes, ["a.md"]);
  setLease(true);
  await clone.sync("write-back");
  assert.equal(remote.text("s.md"), "S2");
});

test("web_push_conflict_writes_copy: the remote file is kept and the web text saved beside it", async () => {
  const { remote, fs, clone } = setup({ "p/a.md": "base" });
  await clone.clone();
  await clone.read("p/a.md");
  await fs.writeFile("p/a.md", "web text");
  remote.push({ "p/a.md": "desktop text" });
  const result = await clone.sync("web edits");
  assert.deepEqual(result.conflicts, ["p/a.conflict-20261120T101200Z.md"]);
  assert.equal(await fs.readText("p/a.md"), "desktop text");
  assert.equal(await fs.readText("p/a.conflict-20261120T101200Z.md"), "web text");
  assert.equal(remote.text("p/a.md"), "desktop text");
  assert.equal(remote.text("p/a.conflict-20261120T101200Z.md"), "web text");
  assert.equal(await clone.unpushed(), 0);
});

test("a remote delete of a file edited on the web keeps the file", async () => {
  const { remote, fs, clone } = setup({ "a.md": "A" });
  await clone.clone();
  await clone.read("a.md");
  await fs.writeFile("a.md", "kept");
  remote.push({ "a.md": null });
  await clone.sync("keep");
  assert.equal(await fs.readText("a.md"), "kept");
  assert.equal(remote.text("a.md"), "kept");
});

test("offline_queue: edits made offline stay counted and go up once back online", async () => {
  const { remote, fs, clone } = setup({ "a.md": "A" });
  await clone.clone();
  await fs.writeFile("a.md", "offline 1");
  await fs.writeFile("b.md", "offline 2");
  remote.down = true;
  await assert.rejects(() => clone.sync("offline"), TypeError);
  assert.equal(await clone.unpushed(), 2);
  remote.down = false;
  await clone.sync("online");
  assert.equal(remote.text("a.md"), "offline 1");
  assert.equal(remote.text("b.md"), "offline 2");
  assert.equal(await clone.unpushed(), 0);
});

test("the clone's own bookkeeping is never pushed", async () => {
  const { remote, clone } = setup({ "a.md": "A" });
  await clone.clone();
  await clone.sync("nothing");
  assert.equal(remote.text(WEB_CLONE_MANIFEST), null);
  assert.equal(remote.commits.length, 0);
});

/*
 * Laws, over random histories: three paths, edits on both sides, pulls and
 * syncs in any order.
 */
const PATHS = ["a.md", "d/b.md", "c.md"];
const text = fc.constantFrom("x", "y", "z", "");
const op = fc.oneof(
  fc.record({ kind: fc.constant("local-write" as const), path: fc.constantFrom(...PATHS), text }),
  fc.record({ kind: fc.constant("local-delete" as const), path: fc.constantFrom(...PATHS) }),
  fc.record({ kind: fc.constant("open" as const), path: fc.constantFrom(...PATHS) }),
  fc.record({ kind: fc.constant("remote-write" as const), path: fc.constantFrom(...PATHS), text }),
  fc.record({ kind: fc.constant("remote-delete" as const), path: fc.constantFrom(...PATHS) }),
  fc.record({ kind: fc.constant("pull" as const) }),
  fc.record({ kind: fc.constant("sync" as const) }),
);

type Op = typeof op extends fc.Arbitrary<infer T> ? T : never;
type Setup = ReturnType<typeof setup>;
type Check = (s: Setup, kind: "pull" | "sync", before: Record<string, string>, conflicts: string[]) => Promise<void>;

async function runOps(ops: Op[], check: Check) {
  const s = setup({ "a.md": "base" });
  await s.clone.clone();
  for (const o of ops) {
    if (o.kind === "local-write") await s.fs.writeFile(o.path, o.text);
    else if (o.kind === "local-delete") await s.fs.remove(o.path);
    else if (o.kind === "open") await s.clone.read(o.path).catch(() => undefined);
    else if (o.kind === "remote-write") s.remote.push({ [o.path]: o.text });
    else if (o.kind === "remote-delete") s.remote.push({ [o.path]: null });
    else {
      const before = await unpushedTexts(s);
      const result = o.kind === "pull" ? await s.clone.pull() : await s.clone.sync("sync");
      await check(s, o.kind, before, result.conflicts);
    }
  }
}

/** Local files whose text differs from what the clone last saw on the remote. */
async function unpushedTexts(s: Setup): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const change of await s.clone.changes()) {
    if (change.bytes) out[change.path] = dec(change.bytes);
  }
  return out;
}

test("law: a pull never loses a local edit; it stays at its path or in a conflict copy", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(op, { maxLength: 25 }), async (ops) => {
      await runOps(ops, async (s, _kind, before, conflicts) => {
        const after = await localFiles(s.fs);
        for (const [path, body] of Object.entries(before)) {
          const kept = after[path] === body || conflicts.some((copy) => after[copy] === body);
          assert.ok(kept, `local edit of ${path} lost`);
        }
      });
    }),
    { numRuns: 150 },
  );
});

test("law: after a sync, every local file matches the remote and nothing is unpushed", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(op, { maxLength: 25 }), async (ops) => {
      await runOps(ops.concat([{ kind: "sync" }]), async (s, kind) => {
        if (kind !== "sync") return;
        const local = await localFiles(s.fs);
        for (const [path, body] of Object.entries(local)) assert.equal(s.remote.text(path), body, path);
        assert.equal(await s.clone.unpushed(), 0);
        for (const path of await s.clone.paths()) assert.ok(s.remote.files.has(path), path);
      });
    }),
    { numRuns: 150 },
  );
});
