import assert from "node:assert/strict";
import test from "node:test";
import { PreferenceStore, type PreferenceFile } from "../src/preference-store";

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
