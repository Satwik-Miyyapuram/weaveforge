/** The keychain store's save queue: one save at a time, mid-save failures, and the index. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DeviceSecretsStore,
  InvalidSecretNameError,
  KeychainIndexCorruptError,
  KeychainUnavailableError,
  PartialSaveError,
  type DeviceKeychain,
} from "../device-secrets-store";
import { fakeKeychain, flat, indexOf, warnings } from "./keychain-fakes";

describe("the save queue, mid-save failure and the index", () => {
  it("runs two concurrent saves one after the other, never interleaved", async () => {
    const log: string[] = [];
    const entries = new Map<string, string>();
    const keychain: DeviceKeychain = {
      read: async (key) => entries.get(key) ?? null,
      write: async (key, text) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        log.push(`${key}=${text}`);
        entries.set(key, text);
      },
      clear: async (key) => {
        entries.delete(key);
      },
    };
    const store = new DeviceSecretsStore(keychain);
    await Promise.all([store.save(flat({ zoteroApiKey: "one" })), store.save(flat({ zoteroApiKey: "two" }))]);
    const index = indexOf(["zoteroApiKey"], "save");
    assert.deepEqual(log, ["zoteroApiKey=one", `_index=${index}`, "zoteroApiKey=two", `_index=${index}`]);
    assert.equal(entries.get("zoteroApiKey"), "two");
  });

  it("puts the earlier fields back when a write fails part way, and names the field that failed", async () => {
    const { entries, keychain } = fakeKeychain({ "_index": indexOf(["a"]), a: "old" });
    const failing: DeviceKeychain = {
      ...keychain,
      write: async (key, text) => {
        if (key === "b") throw new Error("keychain write refused");
        return keychain.write(key, text);
      },
    };
    const store = new DeviceSecretsStore(failing);
    await assert.rejects(() => store.save(flat({ a: "new", b: "x" })), (err: unknown) => {
      assert.ok(err instanceof PartialSaveError);
      assert.match(err.message, /: b \(/);
      return true;
    });
    assert.equal(entries.get("a"), "old");
    assert.equal(entries.get("_index"), indexOf(["a"]));
  });

  it("names the entries it could not put back when the restore also fails", async () => {
    const { entries, keychain } = fakeKeychain({ "_index": indexOf(["a"]), a: "old" });
    let aWrites = 0;
    const failing: DeviceKeychain = {
      ...keychain,
      write: async (key, text) => {
        if (key === "b") throw new Error("refused");
        if (key === "a" && ++aWrites > 1) throw new Error("restore refused");
        return keychain.write(key, text);
      },
    };
    const store = new DeviceSecretsStore(failing);
    await assert.rejects(() => store.save(flat({ a: "new", b: "x" })), (err: unknown) => {
      assert.ok(err instanceof PartialSaveError);
      assert.match(err.message, /: a \(/);
      return true;
    });
    assert.equal(entries.get("a"), "new");
  });

  it("refuses to save over a corrupt index, and writes nothing", async () => {
    const { entries, writes, keychain } = fakeKeychain({ "_index": "not json" });
    const store = new DeviceSecretsStore(keychain);
    await assert.rejects(() => store.save(flat({ zoteroApiKey: "k" })), KeychainIndexCorruptError);
    assert.deepEqual(writes, []);
    assert.equal(entries.get("_index"), "not json");
  });

  it("reports a corrupt index on load as well", async () => {
    const { keychain } = fakeKeychain({ "_index": "{\"keys\":\"nope\"}" });
    const store = new DeviceSecretsStore(keychain);
    await assert.rejects(() => store.load(), KeychainIndexCorruptError);
  });

  it("clears an unreadable index on reset, so a save can run again", async () => {
    const { entries, keychain } = fakeKeychain({ "_index": "not json" });
    const store = new DeviceSecretsStore(keychain);
    assert.equal(await store.resetCorruptIndex(), true);
    assert.equal(entries.has("_index"), false);
    await store.save(flat({ zoteroApiKey: "k" }));
    assert.equal(entries.get("zoteroApiKey"), "k");
  });

  it("leaves a readable index alone on reset", async () => {
    const { entries, keychain } = fakeKeychain({ "_index": indexOf(["zoteroApiKey"]), zoteroApiKey: "k" });
    const store = new DeviceSecretsStore(keychain);
    assert.equal(await store.resetCorruptIndex(), false);
    assert.equal(entries.get("_index"), indexOf(["zoteroApiKey"]));
  });

  it("never reads a write-only entry the save itself writes", async () => {
    const { entries, keychain } = fakeKeychain({ overleafToken: "old" });
    const reads: string[] = [];
    const watched: DeviceKeychain = { ...keychain, read: async (key) => (reads.push(key), keychain.read(key)) };
    await new DeviceSecretsStore(watched).save(flat({ zoteroApiKey: "k", overleafToken: "new" }));
    assert.equal(reads.includes("overleafToken"), false);
    assert.equal(entries.get("overleafToken"), "new");
  });

  it("puts the fields and the index back when the index write fails", async () => {
    const { entries, keychain } = fakeKeychain({ "_index": indexOf(["a"]), a: "old" });
    let indexWrites = 0;
    const failing: DeviceKeychain = {
      ...keychain,
      write: async (key, text) => {
        if (key === "_index" && ++indexWrites === 1) {
          entries.set(key, text);
          throw new Error("index write refused after landing");
        }
        return keychain.write(key, text);
      },
    };
    await assert.rejects(() => new DeviceSecretsStore(failing).save(flat({ b: "x" })), PartialSaveError);
    assert.equal(entries.get("a"), "old");
    assert.equal(entries.has("b"), false);
    assert.equal(entries.get("_index"), indexOf(["a"]));
  });

  it("puts back an entry the first write half-wrote, and keeps that write's own error", async () => {
    const { entries, keychain } = fakeKeychain({ "_index": indexOf(["a"]), a: "old" });
    let aWrites = 0;
    const failing: DeviceKeychain = {
      ...keychain,
      write: async (key, text) => {
        if (key === "a" && ++aWrites === 1) {
          entries.set(key, "garbled");
          throw new KeychainUnavailableError();
        }
        return keychain.write(key, text);
      },
    };
    await assert.rejects(() => new DeviceSecretsStore(failing).save(flat({ a: "new" })), KeychainUnavailableError);
    assert.equal(entries.get("a"), "old");
    assert.equal(entries.get("_index"), indexOf(["a"]));
  });

  it("a load asked during a save waits for it, and never sees half a save", async () => {
    const entries = new Map<string, string>([["_index", indexOf(["a"])], ["a", "old"]]);
    const keychain: DeviceKeychain = {
      read: async (key) => entries.get(key) ?? null,
      write: async (key, text) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        entries.set(key, text);
      },
      clear: async (key) => {
        entries.delete(key);
      },
    };
    const store = new DeviceSecretsStore(keychain);
    const saving = store.save(flat({ b: "new" }));
    const loaded = await store.load();
    await saving;
    assert.deepEqual(loaded, { b: "new" });
  });

  it("skips a listed field that is not the JSON the store wrote, warning its key name only, and loads the rest", async () => {
    const { keychain } = fakeKeychain({
      "_index": indexOf(["integrations.p1", "integrations.p2"]),
      "integrations.p1": "{secret-value",
      "integrations.p2": '{"token":"t"}',
    });
    let loaded: unknown;
    const warned = await warnings(async () => (loaded = await new DeviceSecretsStore(keychain).load()));
    assert.deepEqual(loaded, { integrations: { p2: { token: "t" } } });
    assert.equal(warned.length, 1);
    assert.match(warned.join(), /integrations\.p1/);
    assert.doesNotMatch(warned.join(), /secret-value/);
  });

  it("refuses prototype names on save and treats them in the index as corrupt", async () => {
    const { writes, keychain } = fakeKeychain({});
    const store = new DeviceSecretsStore(keychain);
    await assert.rejects(() => store.save(JSON.parse('{"__proto__":{"x":"1"}}')), InvalidSecretNameError);
    await assert.rejects(() => store.save(flat({ constructor: "v" })), InvalidSecretNameError);
    assert.deepEqual(writes, []);
    const listed = fakeKeychain({ "_index": indexOf(["__proto__.polluted"]), "__proto__.polluted": "true" });
    await assert.rejects(() => new DeviceSecretsStore(listed.keychain).load(), KeychainIndexCorruptError);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  it("names the half-written first entry when putting it back also fails", async () => {
    const { entries, keychain } = fakeKeychain({ "_index": indexOf(["a"]), a: "old" });
    const failing: DeviceKeychain = {
      ...keychain,
      write: async (key, text) => {
        if (key === "a") {
          entries.set(key, "garbled");
          throw new Error("refused");
        }
        return keychain.write(key, text);
      },
    };
    await assert.rejects(() => new DeviceSecretsStore(failing).save(flat({ a: "new" })), (err: unknown) => {
      assert.ok(err instanceof PartialSaveError);
      assert.deepEqual(err.fields, ["a"]);
      return true;
    });
  });

  it("names a write-only entry that was written before a later failure", async () => {
    const { entries, keychain } = fakeKeychain({});
    const failing: DeviceKeychain = {
      ...keychain,
      write: async (key, text) => {
        if (key === "b") throw new Error("refused");
        return keychain.write(key, text);
      },
    };
    await assert.rejects(() => new DeviceSecretsStore(failing).save(flat({ "overleaf-token": "t", b: "x" })), (err: unknown) => {
      assert.ok(err instanceof PartialSaveError);
      assert.deepEqual(err.fields, ["b", "overleaf-token"]);
      return true;
    });
    assert.equal(entries.get("overleaf-token"), "t");
    assert.equal(entries.has("_index"), false);
  });

  it("names a write-only entry whose own write failed, even when a rollback also fails", async () => {
    const { keychain } = fakeKeychain({ "_index": indexOf(["a"]), a: "old" });
    let aWrites = 0;
    const failing: DeviceKeychain = {
      ...keychain,
      write: async (key, text) => {
        if (key === "overleaf-token") throw new Error("refused");
        if (key === "a" && ++aWrites > 1) throw new Error("restore refused");
        return keychain.write(key, text);
      },
    };
    await assert.rejects(() => new DeviceSecretsStore(failing).save(flat({ a: "new", "overleaf-token": "t" })), (err: unknown) => {
      assert.ok(err instanceof PartialSaveError);
      assert.deepEqual(err.fields, ["a", "overleaf-token"]);
      return true;
    });
  });

  it("refuses an index over the cap before writing anything", async () => {
    const { writes, keychain } = fakeKeychain({});
    const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`field${i}`, "v"]));
    await assert.rejects(() => new DeviceSecretsStore(keychain).save(flat(many)), /_index is \d+ bytes/);
    assert.deepEqual(writes, []);
  });

  it("refuses a number, a boolean or an array before writing anything", async () => {
    const { writes, keychain } = fakeKeychain({});
    const store = new DeviceSecretsStore(keychain);
    for (const value of [3, true, ["a"]]) {
      await assert.rejects(() => store.save(flat({ a: value as unknown as string })), InvalidSecretNameError);
    }
    assert.deepEqual(writes, []);
  });

  it("treats an index listing _index, a bad name or a bad sub-key as corrupt", async () => {
    const cases: Array<[string, Record<string, string>]> = [
      ["_index", {}],
      ["a b", { "a b": "v" }],
      ["a._zz", { "a._zz": "1" }],
      ["a._6", { "a._6": "1" }],
      ["a._ff", { "a._ff": "1" }],
      ["a.b-c", { "a.b-c": "1" }],
    ];
    for (const [key, rest] of cases) {
      const { keychain } = fakeKeychain({ "_index": indexOf([key]), ...rest });
      await assert.rejects(() => new DeviceSecretsStore(keychain).load(), KeychainIndexCorruptError, key);
    }
  });

  it("treats a name listed both as text and as fields as corrupt, in either order", async () => {
    for (const keys of [["a", "a.x"], ["a.x", "a"]]) {
      const { keychain } = fakeKeychain({ "_index": indexOf(keys), a: "text", "a.x": "1" });
      await assert.rejects(() => new DeviceSecretsStore(keychain).load(), KeychainIndexCorruptError, keys.join());
    }
  });

  it("round-trips an empty sub-key and a hyphenated write-only name stays unlisted", async () => {
    const { entries, keychain } = fakeKeychain({});
    const store = new DeviceSecretsStore(keychain);
    await store.save({ integrations: { "": "e" } } as unknown as Parameters<DeviceSecretsStore["save"]>[0]);
    assert.deepEqual(await store.load(), { integrations: { "": "e" } });
    await store.save(flat({ "git-sync-token": "t", b: "x" }));
    assert.equal(entries.get("_index"), indexOf(["b"]));
    assert.deepEqual(await store.load(), { b: "x" });
  });
});
