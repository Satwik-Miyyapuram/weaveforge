/**
 * The device credentials live in the OS keychain only, one entry per field, listed by
 * `_index`. No database row is read, copied, written or deleted.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import {
  DeviceSecretsStore,
  desktopKeychain,
  KEYCHAIN_HELP,
  InvalidSecretNameError,
  KeychainFieldCorruptError,
  KeychainIndexCorruptError,
  KeychainUnavailableError,
  keychainHelp,
  PartialSaveError,
  type DeviceKeychain,
} from "../device-secrets-store";

const LOCKED = "The keychain is locked, so the saved credentials cannot be read. Unlock it and try again. Nothing was changed.";

/** A keychain of named entries, recording every key written. */
function fakeKeychain(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));
  const writes: string[] = [];
  const keychain: DeviceKeychain = {
    read: async (key) => entries.get(key) ?? null,
    write: async (key, text) => {
      writes.push(key);
      entries.set(key, text);
    },
    clear: async (key) => {
      entries.delete(key);
    },
  };
  return { entries, writes, keychain };
}

/** A keychain whose reads fail the way a locked keyring does. */
const lockedKeychain: DeviceKeychain = {
  read: async () => {
    throw new Error(LOCKED);
  },
  write: async () => {
    throw new Error(LOCKED);
  },
  clear: async () => {
    throw new Error(LOCKED);
  },
};

/** A keychain on a machine with no Secret Service to store into. */
const noKeychain: DeviceKeychain = {
  read: async () => null,
  write: async () => {
    throw new KeychainUnavailableError();
  },
  clear: async () => undefined,
};

const indexOf = (keys: string[], source = "save") => JSON.stringify({ source, keys });

/** A flat field map for a save: top-level names the typed `Secrets` does not list (the test fixtures). */
const flat = (fields: Record<string, string>) => fields as unknown as Parameters<DeviceSecretsStore["save"]>[0];

describe("device credentials in the keychain", () => {
  it("rebuilds the credentials from the listed fields", async () => {
    const { keychain } = fakeKeychain({
      "_index": indexOf(["zoteroApiKey", "integrations.overleaf"]),
      zoteroApiKey: "k",
      "integrations.overleaf": '{"token":"t"}',
    });
    assert.deepEqual(await new DeviceSecretsStore(keychain).load(), { zoteroApiKey: "k", integrations: { overleaf: { token: "t" } } });
  });

  it("answers with nothing and writes nothing when there is no index", async () => {
    const { writes, keychain } = fakeKeychain();
    assert.deepEqual(await new DeviceSecretsStore(keychain).load(), {});
    assert.equal(writes.length, 0);
  });

  it("saves an empty set as an index with no keys", async () => {
    const { entries, keychain } = fakeKeychain({ zoteroApiKey: "old" });
    const store = new DeviceSecretsStore(keychain);
    await store.save({});
    assert.equal(entries.get("_index"), indexOf([]));
    assert.deepEqual(await store.load(), {});
  });

  it("a save with no index starts from nothing: it writes the new name and the index, and throws nothing", async () => {
    const { keychain, writes } = fakeKeychain();
    await new DeviceSecretsStore(keychain).save({ zoteroApiKey: "k" });
    assert.deepEqual(writes, ["zoteroApiKey", "_index"]);
  });

  it("encodes an odd sub-key as hex behind an underscore and reads it back", async () => {
    const { entries, keychain } = fakeKeychain();
    const store = new DeviceSecretsStore(keychain);
    await store.save({ "ai-provider": { "a b": { key: "v" } } } as never);
    // "a b" is 61 20 62 in hex.
    assert.equal(entries.get("ai-provider._612062"), '{"key":"v"}');
    assert.deepEqual(await store.load(), { "ai-provider": { "a b": { key: "v" } } });
  });

  it("a locked keychain rejects the load", async () => {
    await assert.rejects(() => new DeviceSecretsStore(lockedKeychain).load(), /keychain is locked/);
  });

  it("saves one entry per field, then the index", async () => {
    const { entries, writes, keychain } = fakeKeychain();
    await new DeviceSecretsStore(keychain).save({ zoteroApiKey: "k", integrations: { overleaf: { token: "t" } } });

    assert.deepEqual(writes, ["zoteroApiKey", "integrations.overleaf", "_index"]);
    assert.equal(entries.get("zoteroApiKey"), "k");
    assert.equal(entries.get("integrations.overleaf"), '{"token":"t"}');
    assert.deepEqual(JSON.parse(entries.get("_index") ?? "{}"), {
      source: "save",
      keys: ["zoteroApiKey", "integrations.overleaf"],
    });
  });

  it("clears the entries a save no longer has", async () => {
    const { entries, keychain } = fakeKeychain({
      "_index": indexOf(["zoteroApiKey", "semanticScholarKey"]),
      zoteroApiKey: "k",
      semanticScholarKey: "s",
    });
    await new DeviceSecretsStore(keychain).save({ zoteroApiKey: "k" });
    assert.equal(entries.has("semanticScholarKey"), false);
    assert.deepEqual(JSON.parse(entries.get("_index") ?? "{}").keys, ["zoteroApiKey"]);
  });

  it("round-trips a realistic integrations payload, each entry under the Windows blob cap", async () => {
    const WINDOWS_CAP = 2560;
    const providers = ["overleaf", "zotero", "mattermost", "github"];
    const integrations: Record<string, Record<string, string>> = {};
    for (const provider of providers) {
      integrations[provider] = {};
      for (let i = 0; i < 8; i += 1) integrations[provider][`field${i}`] = "x".repeat(130);
    }
    const secrets = { zoteroApiKey: "z".repeat(40), integrations };
    assert.ok(JSON.stringify(secrets).length > WINDOWS_CAP, "the whole payload is over the cap");

    const { entries, keychain } = fakeKeychain();
    await new DeviceSecretsStore(keychain).save(secrets);
    for (const [key, text] of entries) {
      assert.ok(Buffer.byteLength(text, "utf8") <= WINDOWS_CAP, `${key} fits one entry`);
    }
    assert.deepEqual(await new DeviceSecretsStore(keychain).load(), secrets);
  });

  it("says so, with the install command, when a save has no keychain", async () => {
    await assert.rejects(
      () => new DeviceSecretsStore(noKeychain).save({ zoteroApiKey: "k" }),
      (err: unknown) => {
        assert.ok(err instanceof KeychainUnavailableError);
        assert.equal(err.message, KEYCHAIN_HELP);
        assert.match(err.message, /Install/);
        return true;
      },
    );
  });

  it("never writes a secret value to a log", async () => {
    const secret = "SECRET-VALUE-XYZ-123456";
    const logged: string[] = [];
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((m) => {
      const original = console[m];
      console[m] = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
      return () => { console[m] = original; };
    });
    try {
      const { keychain } = fakeKeychain();
      const store = new DeviceSecretsStore(keychain);
      await store.save({ zoteroApiKey: secret });
      await store.load();
      await assert.rejects(() => new DeviceSecretsStore(noKeychain).save({ zoteroApiKey: secret }));
    } finally {
      spies.forEach((restore) => restore());
    }
    assert.equal(logged.filter((line) => line.includes(secret)).length, 0);
  });

  it("accepts a field of exactly 2560 bytes (1280 UTF-16 units)", async () => {
    const { entries, keychain } = fakeKeychain();
    await new DeviceSecretsStore(keychain).save(flat({ overleafToken: "x".repeat(1280) }));
    assert.equal(entries.get("overleafToken"), "x".repeat(1280));
  });

  it("refuses a 2 KB token over the cap before writing anything, never truncating", async () => {
    const { entries, writes, keychain } = fakeKeychain();
    // A 1281-unit field is 2562 bytes: over the cap by two.
    const huge = "x".repeat(1281);
    await assert.rejects(
      () => new DeviceSecretsStore(keychain).save(flat({ zoteroApiKey: "k", overleafToken: huge })),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /overleafToken/);
        assert.match(err.message, /2560/);
        return true;
      },
    );
    assert.equal(writes.length, 0, "no entry is written when a field is too large");
    assert.equal(entries.size, 0);
  });

  it("refuses a top-level name with a dot before writing anything", async () => {
    const { writes, keychain } = fakeKeychain();
    await assert.rejects(() => new DeviceSecretsStore(keychain).save({ "a.b": "x" } as never), /a\.b/);
    assert.equal(writes.length, 0);
  });

  it("refuses a top-level name the keychain cannot store, before writing any field", async () => {
    const { writes, keychain } = fakeKeychain();
    await assert.rejects(
      () => new DeviceSecretsStore(keychain).save(flat({ zoteroApiKey: "k", "bad name": "v" })),
      /bad name is not a name the keychain can store/,
    );
    assert.deepEqual(writes, []);
  });
});

describe("the desktop keychain adapter", () => {
  it("maps the shell's no-keychain refusal to KeychainUnavailableError", async () => {
    const bridge = {
      readSecret: async () => null,
      writeSecret: async () => {
        throw new Error(
          "This machine has no keychain available, so there is nowhere safe to keep it. It stays in memory for this session.",
        );
      },
    } as unknown as DesktopBridge;
    await assert.rejects(
      () => desktopKeychain(bridge).write("zoteroApiKey", "k"),
      (err: unknown) => err instanceof KeychainUnavailableError,
    );
  });

  it("passes any other keychain failure through unchanged", async () => {
    const bridge = {
      readSecret: async () => null,
      writeSecret: async () => {
        throw new Error("The keychain could not be reached just now, so nothing was changed.");
      },
    } as unknown as DesktopBridge;
    await assert.rejects(
      () => desktopKeychain(bridge).write("zoteroApiKey", "k"),
      (err: unknown) => !(err instanceof KeychainUnavailableError),
    );
  });

  it("maps each key to its own device field entry", async () => {
    const asked: string[] = [];
    const cleared: string[] = [];
    const bridge = {
      readSecret: async (name: string) => {
        asked.push(name);
        return "v";
      },
      writeSecret: async () => undefined,
      clearSecret: async (name: string) => {
        cleared.push(name);
      },
    } as unknown as DesktopBridge;
    const keychain = desktopKeychain(bridge);
    assert.equal(await keychain.read("zoteroApiKey"), "v");
    await keychain.clear("integrations.overleaf");
    assert.deepEqual(asked, ["device-secrets/zoteroApiKey"]);
    assert.deepEqual(cleared, ["device-secrets/integrations.overleaf"]);
  });

  it("lets a locked-keychain read error propagate", async () => {
    const bridge = {
      readSecret: async () => {
        throw new Error(LOCKED);
      },
    } as unknown as DesktopBridge;
    await assert.rejects(() => desktopKeychain(bridge).read("_index"), /keychain is locked/);
  });
});

const NO_KEYCHAIN_TEXT =
  "This machine has no keychain available, so there is nowhere safe to keep it. It stays in memory for this session.";

describe("no keychain on this machine (Linux without a Secret Service)", () => {
  it("maps the shell's refusal on a read to KeychainUnavailableError, so the install dialog shows", async () => {
    const bridge = {
      readSecret: async () => {
        throw new Error(NO_KEYCHAIN_TEXT);
      },
    } as unknown as DesktopBridge;
    await assert.rejects(() => desktopKeychain(bridge).read("_index"), KeychainUnavailableError);
  });
});

describe("reserved keychain names", () => {
  it("refuses a top-level credential named _index, because it would overwrite the index entry", async () => {
    const { writes, keychain } = fakeKeychain();
    const store = new DeviceSecretsStore(keychain);
    await assert.rejects(() => store.save(flat({ _index: "x" })), /_index is reserved/);
    assert.deepEqual(writes, []);
  });
});

/** Captures console.warn while `work` runs. */
async function warnings(work: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void seen.push(args.map(String).join(" "));
  try {
    await work();
  } finally {
    console.warn = original;
  }
  return seen;
}

describe("a field the index lists but the keychain lacks", () => {
  it("is skipped on load and warned by its key name only, so the rest still loads", async () => {
    const { keychain } = fakeKeychain({
      "_index": indexOf(["zoteroApiKey", "integrations.overleaf"]),
      "integrations.overleaf": '{"token":"SECRETVALUE"}',
    });
    const store = new DeviceSecretsStore(keychain);
    let loaded: unknown;
    const warned = await warnings(async () => (loaded = await store.load()));
    assert.deepEqual(loaded, { integrations: { overleaf: { token: "SECRETVALUE" } } });
    assert.equal(warned.length, 1);
    assert.match(warned.join(), /zoteroApiKey/);
    assert.doesNotMatch(warned.join(), /SECRETVALUE/);
  });

  it("a later save still works and drops the missing field from the index", async () => {
    const { entries, keychain } = fakeKeychain({ "_index": indexOf(["a", "b"]), b: "kept" });
    const store = new DeviceSecretsStore(keychain);
    await warnings(async () => store.save(flat({ ...((await store.load()) as Record<string, string>), c: "new" })));
    assert.equal(entries.get("_index"), indexOf(["b", "c"]));
  });
});

describe("a save that stops part way through", () => {
  it("writes the new index before clearing dropped fields, so a crash after the first clear still loads", async () => {
    const { entries, keychain } = fakeKeychain({ "_index": indexOf(["a", "b", "c"]), a: "old", b: "x", c: "y" });
    // The process dies once the first clear lands: every later keychain call fails.
    let dead = false;
    const dying: DeviceKeychain = {
      read: async (key) => {
        if (dead) throw new Error("process gone");
        return keychain.read(key);
      },
      write: async (key, text) => {
        if (dead) throw new Error("process gone");
        return keychain.write(key, text);
      },
      clear: async (key) => {
        if (dead) throw new Error("process gone");
        await keychain.clear(key);
        dead = true;
      },
    };
    await new DeviceSecretsStore(dying).save(flat({ a: "new" })).catch(() => undefined);
    // Reload on a fresh store over what is left in the keychain.
    let loaded: unknown;
    const warned = await warnings(async () => (loaded = await new DeviceSecretsStore(keychain).load()));
    assert.deepEqual(loaded, { a: "new" });
    assert.deepEqual(warned, []);
    assert.equal(entries.get("_index"), indexOf(["a"]));
  });

  it("leaves the dropped field as a harmless orphan when the clear itself fails", async () => {
    const { entries, keychain } = fakeKeychain({ "_index": indexOf(["a", "b"]), a: "old", b: "x" });
    const failing: DeviceKeychain = { ...keychain, clear: async () => Promise.reject(new Error("clear refused")) };
    await assert.rejects(() => new DeviceSecretsStore(failing).save(flat({ a: "new" })), PartialSaveError);
    const loaded = await new DeviceSecretsStore(keychain).load();
    // Rolled back to the old index, and every field it lists is there.
    assert.deepEqual(loaded, { a: "old", b: "x" });
    assert.equal(entries.get("_index"), indexOf(["a", "b"]));
  });
});

describe("one queue per keychain, across store instances", () => {
  it("two stores on the same keychain save one after the other, and _index lists the last save", async () => {
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
        await new Promise((resolve) => setTimeout(resolve, 1));
        log.push(`clear ${key}`);
        entries.delete(key);
      },
    };
    const one = new DeviceSecretsStore(keychain);
    const two = new DeviceSecretsStore(keychain);
    await Promise.all([one.save(flat({ a: "1", b: "1" })), two.save(flat({ c: "2" }))]);
    assert.deepEqual(log, [
      "a=1",
      "b=1",
      `_index=${indexOf(["a", "b"])}`,
      "c=2",
      `_index=${indexOf(["c"])}`,
      "clear a",
      "clear b",
    ]);
    assert.equal(entries.get("_index"), indexOf(["c"]));
    assert.deepEqual(await one.load(), { c: "2" });
  });

  it("gives the same keychain for the same shell bridge, so default stores share one queue", () => {
    const bridge = { readSecret: async () => null, writeSecret: async () => undefined, clearSecret: async () => undefined } as unknown as DesktopBridge;
    assert.equal(desktopKeychain(bridge), desktopKeychain(bridge));
  });
});

describe("write-only names in the index", () => {
  it("load and save skip a write-only name the index lists, and never read its entry", async () => {
    const { entries, keychain } = fakeKeychain({
      "_index": indexOf(["zoteroApiKey", "overleafToken", "gitSyncToken"]),
      zoteroApiKey: "k",
    });
    const reads: string[] = [];
    const watched: DeviceKeychain = {
      read: async (key) => {
        reads.push(key);
        return keychain.read(key);
      },
      write: keychain.write,
      clear: keychain.clear,
    };
    const store = new DeviceSecretsStore(watched);
    assert.deepEqual(await store.load(), { zoteroApiKey: "k" });
    await store.save({ zoteroApiKey: "k" });
    assert.equal(reads.includes("overleafToken"), false);
    assert.equal(reads.includes("gitSyncToken"), false);
    assert.deepEqual(JSON.parse(entries.get("_index") ?? "{}").keys, ["zoteroApiKey"]);
  });

  it("save writes a write-only entry but never lists it in the index", async () => {
    const { entries, keychain } = fakeKeychain({});
    const store = new DeviceSecretsStore(keychain);
    const secrets = { zoteroApiKey: "k", overleafToken: "t" } as unknown as Parameters<typeof store.save>[0];
    await store.save(secrets);
    assert.equal(entries.get("overleafToken"), "t");
    assert.deepEqual(JSON.parse(entries.get("_index") ?? "{}").keys, ["zoteroApiKey"]);
  });
});

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

  it("names only the key when a listed field is not the JSON the store wrote", async () => {
    const { keychain } = fakeKeychain({ "_index": indexOf(["integrations.p1"]), "integrations.p1": "{secret-value" });
    await assert.rejects(() => new DeviceSecretsStore(keychain).load(), (err: unknown) => {
      assert.ok(err instanceof KeychainFieldCorruptError);
      assert.equal(err.key, "integrations.p1");
      assert.doesNotMatch(err.message, /secret-value/);
      return true;
    });
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

describe("the keychain help by platform", () => {
  it("gives Linux the package commands, and macOS and Windows their own steps with no apt", () => {
    assert.match(keychainHelp("Mozilla/5.0 (X11; Linux x86_64)"), /sudo apt install gnome-keyring libsecret-1-0/);
    const mac = keychainHelp("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)");
    const windows = keychainHelp("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    assert.match(mac, /Keychain Access/);
    assert.match(windows, /Credential Manager/);
    assert.doesNotMatch(mac, /apt/);
    assert.doesNotMatch(windows, /apt/);
  });
});
