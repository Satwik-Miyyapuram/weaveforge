import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PreferenceStore, type PreferenceFile } from "../src/preference-store";
import { temporaryName } from "../src/write-queue";

/** A file that lives in a variable. */
function file(initial: string | null = null): PreferenceFile & { contents: string | null } {
  return {
    contents: initial,
    async read() {
      return this.contents;
    },
    async write(contents: string) {
      this.contents = contents;
    },
  };
}

test("a preference that was never set reads as nothing", async () => {
  const store = new PreferenceStore(file());
  assert.deepEqual(await store.read("sync-offer-shown"), { ok: true, value: null });
});

test("what was written is what comes back", async () => {
  const disk = file();
  const store = new PreferenceStore(disk);

  await store.write("sync-offer-shown", true);
  await store.write("sync-target", "https://sync.example");

  assert.deepEqual(await store.read("sync-offer-shown"), { ok: true, value: true });
  assert.deepEqual(await store.read("sync-target"), { ok: true, value: "https://sync.example" });
});

test("writing null forgets it rather than storing a null", async () => {
  const disk = file();
  const store = new PreferenceStore(disk);

  await store.write("sync-target", "https://sync.example");
  await store.write("sync-target", null);

  assert.deepEqual(await store.read("sync-target"), { ok: true, value: null });
  assert.equal(disk.contents?.includes("sync-target"), false);
});

test("a name this app does not remember is refused", async () => {
  const store = new PreferenceStore(file());
  const read = await store.read("plan");
  const written = await store.write("plan", "free");

  assert.equal(read.ok, false);
  assert.equal(written.ok, false);
});

test("a value that is not a preference is refused rather than stored", async () => {
  const disk = file();
  const store = new PreferenceStore(disk);

  assert.equal((await store.write("sync-target", { url: "https://sync.example" })).ok, false);
  assert.equal(disk.contents, null);
});

test("a file edited into nonsense costs the preferences, not the launch", async () => {
  const store = new PreferenceStore(file("{ not json"));
  assert.deepEqual(await store.read("sync-offer-shown"), { ok: true, value: null });
});

test("a value of an unexpected shape on file reads as absent", async () => {
  const store = new PreferenceStore(file(JSON.stringify({ "sync-target": { host: "x" } })));
  assert.deepEqual(await store.read("sync-target"), { ok: true, value: null });
});

test("writing keeps the preferences that were already there", async () => {
  const disk = file(JSON.stringify({ "sync-offer-shown": true }));
  const store = new PreferenceStore(disk);

  await store.write("sync-target", "https://sync.example");

  assert.deepEqual(await store.read("sync-offer-shown"), { ok: true, value: true });
});

// ------------------------------------------------------------ concurrent writes

/**
 * A file with a real gap between its read and its write.
 *
 * The bug this file is about lives in that gap. Without one, each write's read
 * and write complete in the same microtask, the cycle never interleaves, and a
 * test would pass whether or not writes were serialised at all.
 */
function slowFile(initial: string | null = null) {
  const state = {
    contents: initial,
    written: [] as string[],
  };
  const disk: PreferenceFile = {
    async read() {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return state.contents;
    },
    async write(contents: string) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      state.contents = contents;
      state.written.push(contents);
    },
  };
  return { disk, state };
}

test("concurrent writes to different preferences all land", async () => {
  const { disk, state } = slowFile();
  const store = new PreferenceStore(disk);

  // Three writes in the same tick, which is what two windows or a settings
  // panel saving four fields at once actually does.
  await Promise.all([
    store.write("sync-offer-shown", true),
    store.write("sync-target", "https://sync.example"),
    store.write("vault-git", true),
  ]);

  // The lost update, in one line: an unserialised read-modify-write leaves only
  // the last writer's key on disk, because each of them read the same empty
  // file and wrote back a copy holding only its own change.
  assert.deepEqual(await store.read("sync-offer-shown"), { ok: true, value: true });
  assert.deepEqual(await store.read("sync-target"), { ok: true, value: "https://sync.example" });
  assert.deepEqual(await store.read("vault-git"), { ok: true, value: true });
  assert.equal(state.written.length, 3);
  assert.deepEqual(JSON.parse(state.written[2] ?? "{}"), {
    "sync-offer-shown": true,
    "sync-target": "https://sync.example",
    "vault-git": true,
  });
});

test("no draft file is left behind, and no two writes share one", async () => {
  // The draft name used to be the pid and nothing else, so two writes in this
  // process picked the same one and the loser's rename published the winner's
  // bytes. The file is written the way `main.ts` writes it — draft, then rename
  // — so that the drafts are real files this test can count.
  const dir = await mkdtemp(path.join(tmpdir(), "weaveforge-preferences-"));
  const file = path.join(dir, "preferences.json");
  const drafts: string[] = [];
  const disk: PreferenceFile = {
    read: async () => readFile(file, "utf8").catch(() => null),
    write: async (contents) => {
      const draft = `${file}.${temporaryName()}`;
      drafts.push(draft);
      await new Promise((resolve) => setTimeout(resolve, 1));
      await writeFile(draft, contents);
      await rename(draft, file);
    },
  };
  const store = new PreferenceStore(disk);

  await Promise.all([
    store.write("sync-target", "https://sync.example"),
    store.write("vault-git", true),
    store.write("sync-offer-shown", false),
  ]);

  assert.equal(new Set(drafts).size, drafts.length, "two writes shared a draft file");
  // Only the real file is left: every draft was renamed onto it.
  assert.deepEqual(await readdir(dir), ["preferences.json"]);
  assert.deepEqual(await store.read("sync-target"), { ok: true, value: "https://sync.example" });
});

test("a write that fails does not stop the ones queued behind it", async () => {
  const state = { contents: null as string | null };
  let writes = 0;
  const disk: PreferenceFile = {
    async read() {
      return state.contents;
    },
    async write(contents: string) {
      writes += 1;
      if (writes === 1) throw new Error("the disk said no");
      state.contents = contents;
    },
  };
  const store = new PreferenceStore(disk);

  const first = store.write("sync-target", "https://first.example");
  const second = store.write("vault-git", true);

  // The first write's failure is the first caller's business. Nothing about it
  // should reach the second, or a queued write would inherit a stranger's error.
  await assert.rejects(() => first);
  assert.deepEqual(await second, { ok: true, value: null });
  assert.deepEqual(await store.read("vault-git"), { ok: true, value: true });

  // And the queue is still usable afterwards rather than left rejected.
  assert.deepEqual(await store.write("sync-target", "https://later.example"), { ok: true, value: null });
  assert.deepEqual(await store.read("sync-target"), { ok: true, value: "https://later.example" });
});
