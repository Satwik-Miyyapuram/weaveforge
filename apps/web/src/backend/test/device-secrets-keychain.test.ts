/**
 * The device credentials live in the OS keychain, one entry per field, listed by
 * `_index`. The local database row is read-only here: it is never copied (the shell's
 * one-time migration moves it), written, or deleted.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import {
  DeviceSecretsStore,
  desktopKeychain,
  KEYCHAIN_HELP,
  KeychainIndexCorruptError,
  KeychainUnavailableError,
  desktopMoveSecrets,
  keychainHelp,
  LegacySecretsReadError,
  PartialSaveError,
  SecretsNotMovedError,
  type DeviceKeychain,
} from "../providers/local/parts";

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

/** Records every statement the store runs against the local database. */
function fakeRun(rows: unknown[] | Error) {
  const asked: string[] = [];
  const run = async (sql: string) => {
    asked.push(sql);
    if (rows instanceof Error) throw rows;
    return rows;
  };
  return { asked, run };
}

const indexOf = (keys: string[], source = "move") => JSON.stringify({ source, keys });

/** A flat field map for a save: top-level names the typed `Secrets` does not list (the test fixtures). */
const flat = (fields: Record<string, string>) => fields as unknown as Parameters<DeviceSecretsStore["save"]>[0];

describe("device credentials in the keychain", () => {
  it("rebuilds the credentials from the listed fields without touching the local database", async () => {
    const { keychain } = fakeKeychain({
      "_index": indexOf(["zoteroApiKey", "integrations.overleaf"]),
      zoteroApiKey: "k",
      "integrations.overleaf": '{"token":"t"}',
    });
    const db = fakeRun([]);
    const store = new DeviceSecretsStore(db.run, keychain);
    assert.deepEqual(await store.load(), { zoteroApiKey: "k", integrations: { overleaf: { token: "t" } } });
    assert.equal(db.asked.length, 0);
  });

  it("reads the legacy row read-only and copies nothing into the keychain", async () => {
    const { entries, writes, keychain } = fakeKeychain();
    const db = fakeRun([{ secrets: '{"zoteroApiKey":"k"}' }]);
    const store = new DeviceSecretsStore(db.run, keychain);

    assert.deepEqual(await store.load(), { zoteroApiKey: "k" });
    assert.equal(writes.length, 0, "no keychain entry is written on load");
    assert.equal(entries.size, 0);
    assert.ok(db.asked.length > 0);
    for (const sql of db.asked) {
      assert.match(sql, /^\s*select\b/i, "the row is read, never written or deleted");
    }
  });

  it("accepts a row whose json column is already an object", async () => {
    const store = new DeviceSecretsStore(
      fakeRun([{ secrets: { zoteroApiKey: "k", integrations: { overleaf: { token: "t" } } } }]).run,
      fakeKeychain().keychain,
    );
    assert.deepEqual(await store.load(), { zoteroApiKey: "k", integrations: { overleaf: { token: "t" } } });
  });

  it("answers with nothing and writes nothing when there is no index and no row", async () => {
    const { writes, keychain } = fakeKeychain();
    const store = new DeviceSecretsStore(fakeRun([]).run, keychain);
    assert.deepEqual(await store.load(), {});
    assert.equal(writes.length, 0);
  });

  it("reads as no credentials when the local database is missing or stopped, and writes nothing", async () => {
    const { writes, keychain } = fakeKeychain();
    const store = new DeviceSecretsStore(fakeRun(new Error("db down")).run, keychain);
    assert.deepEqual(await store.load(), {});
    assert.equal(writes.length, 0);
  });

  it("saves an empty set as an index with no keys, so a later load reads nothing from the database", async () => {
    const { entries, keychain } = fakeKeychain();
    const db = fakeRun([{ secrets: '{"zoteroApiKey":"old"}' }]);
    const store = new DeviceSecretsStore(db.run, keychain);
    await store.save({});
    assert.equal(entries.get("_index"), indexOf([], "save"));
    assert.deepEqual(await new DeviceSecretsStore(db.run, keychain).load(), {});
  });

  it("encodes an odd sub-key as hex behind an underscore and reads it back", async () => {
    const { entries, keychain } = fakeKeychain();
    const store = new DeviceSecretsStore(fakeRun([]).run, keychain);
    await store.save({ "ai-provider": { "a b": { key: "v" } } } as never);
    // "a b" is 61 20 62 in hex.
    assert.equal(entries.get("ai-provider._612062"), '{"key":"v"}');
    assert.deepEqual(await store.load(), { "ai-provider": { "a b": { key: "v" } } });
  });

  it("refuses a top-level name with a dot before writing anything", async () => {
    const { writes, keychain } = fakeKeychain();
    const store = new DeviceSecretsStore(fakeRun([]).run, keychain);
    await assert.rejects(() => store.save({ "a.b": "x" } as never), /a\.b/);
    assert.equal(writes.length, 0);
  });

  it("a locked keychain rejects the load and never falls back to the database", async () => {
    const db = fakeRun([{ secrets: '{"zoteroApiKey":"k"}' }]);
    const store = new DeviceSecretsStore(db.run, lockedKeychain);
    await assert.rejects(() => store.load(), /keychain is locked/);
    assert.equal(db.asked.length, 0);
  });

  it("saves one entry per field, then the index, and runs no statement", async () => {
    const { entries, writes, keychain } = fakeKeychain();
    const db = fakeRun([]);
    const store = new DeviceSecretsStore(db.run, keychain);
    await store.save({ zoteroApiKey: "k", integrations: { overleaf: { token: "t" } } });

    assert.deepEqual(writes, ["zoteroApiKey", "integrations.overleaf", "_index"]);
    assert.equal(entries.get("zoteroApiKey"), "k");
    assert.equal(entries.get("integrations.overleaf"), '{"token":"t"}');
    assert.deepEqual(JSON.parse(entries.get("_index") ?? "{}"), {
      source: "save",
      keys: ["zoteroApiKey", "integrations.overleaf"],
    });
    assert.equal(db.asked.length, 0);
  });

  it("clears the entries a save no longer has", async () => {
    const { entries, keychain } = fakeKeychain({
      "_index": indexOf(["zoteroApiKey", "semanticScholarKey"]),
      zoteroApiKey: "k",
      semanticScholarKey: "s",
    });
    await new DeviceSecretsStore(fakeRun([]).run, keychain).save({ zoteroApiKey: "k" });
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
    await new DeviceSecretsStore(fakeRun([]).run, keychain).save(secrets);
    for (const [key, text] of entries) {
      assert.ok(Buffer.byteLength(text, "utf8") <= WINDOWS_CAP, `${key} fits one entry`);
    }
    assert.deepEqual(await new DeviceSecretsStore(fakeRun([]).run, keychain).load(), secrets);
  });

  it("says so, with the install command, when a save has no keychain", async () => {
    const db = fakeRun([]);
    const store = new DeviceSecretsStore(db.run, noKeychain);
    await assert.rejects(
      () => store.save({ zoteroApiKey: "k" }),
      (err: unknown) => {
        assert.ok(err instanceof KeychainUnavailableError);
        assert.equal(err.message, KEYCHAIN_HELP);
        assert.match(err.message, /Install/);
        return true;
      },
    );
    assert.equal(db.asked.length, 0, "nothing is written to a file or a row");
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
      const store = new DeviceSecretsStore(fakeRun([]).run, keychain);
      await store.save({ zoteroApiKey: secret });
      await store.load();
      await assert.rejects(() => new DeviceSecretsStore(fakeRun([]).run, noKeychain).save({ zoteroApiKey: secret }));
    } finally {
      spies.forEach((restore) => restore());
    }
    assert.equal(logged.filter((line) => line.includes(secret)).length, 0);
  });
  it("accepts a field of exactly 2560 bytes (1280 UTF-16 units)", async () => {
    const { entries, keychain } = fakeKeychain();
    const store = new DeviceSecretsStore(fakeRun([]).run, keychain);
    await store.save(flat({ overleafToken: "x".repeat(1280) }));
    assert.equal(entries.get("overleafToken"), "x".repeat(1280));
  });

  it("refuses a 2 KB token over the cap before writing anything, never truncating", async () => {
    const { entries, writes, keychain } = fakeKeychain();
    const db = fakeRun([]);
    const store = new DeviceSecretsStore(db.run, keychain);
    // A 1281-unit field is 2562 bytes: over the cap by two.
    const huge = "x".repeat(1281);
    await assert.rejects(
      () => store.save(flat({ zoteroApiKey: "k", overleafToken: huge })),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /overleafToken/);
        assert.match(err.message, /2560/);
        return true;
      },
    );
    assert.equal(writes.length, 0, "no entry is written when a field is too large");
    assert.equal(entries.size, 0);
    assert.equal(db.asked.length, 0);
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

describe("the save gate waits for the one-time move", () => {
  const INDEX = "_index";

  it("refuses to save with secrets-move-pending and writes nothing when the move fails (stopped database, no index)", async () => {
    const { keychain, writes } = fakeKeychain();
    const moveSecrets = async () => {
      throw new Error("the local database is stopped");
    };
    const store = new DeviceSecretsStore(fakeRun([]).run, keychain, moveSecrets);
    await assert.rejects(store.save({ zoteroApiKey: "k" }), (err: { code?: string }) => err.code === "secrets-move-pending");
    assert.deepEqual(writes, []);
  });

  it("saves once the move has written the index", async () => {
    const { keychain, writes, entries } = fakeKeychain();
    const moveSecrets = async () => {
      entries.set(INDEX, indexOf([]));
    };
    const store = new DeviceSecretsStore(fakeRun([]).run, keychain, moveSecrets);
    await store.save({ zoteroApiKey: "k" });
    assert.deepEqual(writes, ["zoteroApiKey", INDEX]);
    assert.deepEqual(await store.load(), { zoteroApiKey: "k" });
  });

  it("does not run the move again once the index exists", async () => {
    const { keychain } = fakeKeychain({ [INDEX]: indexOf(["zoteroApiKey"]), zoteroApiKey: "old" });
    let moves = 0;
    const store = new DeviceSecretsStore(fakeRun([]).run, keychain, async () => {
      moves += 1;
    });
    await store.save({ zoteroApiKey: "new" });
    assert.equal(moves, 0);
  });
});

describe("keychain names", () => {
  it("refuses a top-level name the keychain cannot store, before writing any field", async () => {
    const { writes, keychain } = fakeKeychain();
    const store = new DeviceSecretsStore(fakeRun([]).run, keychain);
    await assert.rejects(
      () => store.save(flat({ zoteroApiKey: "k", "bad name": "v" })),
      /bad name is not a name the keychain can store/,
    );
    assert.deepEqual(writes, []);
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

  it("maps the shell's refusal on the one-time move to KeychainUnavailableError", async () => {
    const bridge = {
      migrate097MoveSecrets: async () => {
        throw new Error(NO_KEYCHAIN_TEXT);
      },
    } as unknown as DesktopBridge;
    await assert.rejects(() => desktopMoveSecrets(bridge)(), KeychainUnavailableError);
  });

  it("names the write-only fields the move left behind, and the error carries only those names", async () => {
    const bridge = {
      migrate097MoveSecrets: async () => ["overleafToken.extra"],
    } as unknown as DesktopBridge;
    const err: unknown = await desktopMoveSecrets(bridge)().then(
      () => undefined,
      (e: unknown) => e,
    );
    assert.ok(err instanceof SecretsNotMovedError, "the move must reject with SecretsNotMovedError");
    assert.deepEqual(err.fields, ["overleafToken.extra"]);
    assert.match(err.message, /overleafToken\.extra/);
  });

  it("a save whose move left fields behind rejects with those names and writes nothing", async () => {
    const { keychain, writes } = fakeKeychain();
    const moveSecrets = async () => {
      throw new SecretsNotMovedError(["overleafToken.extra"]);
    };
    const store = new DeviceSecretsStore(fakeRun([]).run, keychain, moveSecrets);
    const err: unknown = await store.save({ zoteroApiKey: "k" }).then(
      () => undefined,
      (e: unknown) => e,
    );
    assert.ok(err instanceof SecretsNotMovedError, "the save must surface SecretsNotMovedError, not SecretsMovePendingError");
    assert.match(err.message, /overleafToken\.extra/);
    assert.deepEqual(writes, []);
  });

  it("a move that moved every field still resolves", async () => {
    const bridge = {
      migrate097MoveSecrets: async () => [],
    } as unknown as DesktopBridge;
    await desktopMoveSecrets(bridge)();
  });

  it("a save whose move hits no keychain rejects with KeychainUnavailableError, not secrets-move-pending", async () => {
    const { keychain, writes } = fakeKeychain();
    const moveSecrets = async () => {
      throw new KeychainUnavailableError();
    };
    const store = new DeviceSecretsStore(fakeRun([]).run, keychain, moveSecrets);
    await assert.rejects(store.save({ zoteroApiKey: "k" }), KeychainUnavailableError);
    assert.deepEqual(writes, []);
  });
});

describe("reserved keychain names", () => {
  it("refuses a top-level credential named _index, because it would overwrite the index entry", async () => {
    const { writes, keychain } = fakeKeychain();
    const store = new DeviceSecretsStore(fakeRun([]).run, keychain);
    await assert.rejects(() => store.save(flat({ _index: "x" })), /_index is reserved/);
    assert.deepEqual(writes, []);
  });
});

describe("the old database folder probe", () => {
  const noMove = async () => undefined;

  it("a failed legacy read with no old folder is no secrets, not an error", async () => {
    const { keychain } = fakeKeychain();
    const db = fakeRun(new Error("no such table"));
    const store = new DeviceSecretsStore(db.run, keychain, noMove, async () => false);
    assert.deepEqual(await store.load(), {});
  });

  it("a failed legacy read with the old folder present throws, never reads as empty", async () => {
    const { keychain } = fakeKeychain();
    const db = fakeRun(new Error("database is stopped"));
    const store = new DeviceSecretsStore(db.run, keychain, noMove, async () => true);
    await assert.rejects(store.load(), LegacySecretsReadError);
  });
});

describe("a field the index lists but the keychain lacks", () => {
  it("is surfaced by its key name, never skipped silently, and no value is shown", async () => {
    const { keychain } = fakeKeychain({
      "_index": indexOf(["zoteroApiKey", "integrations.overleaf"]),
      "integrations.overleaf": '{"token":"SECRETVALUE"}',
    });
    const store = new DeviceSecretsStore(fakeRun([]).run, keychain);
    await assert.rejects(store.load(), (err: { code?: string; message: string }) => {
      assert.equal(err.code, "keychain-field-missing");
      assert.match(err.message, /zoteroApiKey/);
      assert.doesNotMatch(err.message, /SECRETVALUE/);
      return true;
    });
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
    const store = new DeviceSecretsStore(fakeRun([]).run, watched);
    assert.deepEqual(await store.load(), { zoteroApiKey: "k" });
    await store.save({ zoteroApiKey: "k" });
    assert.equal(reads.includes("overleafToken"), false);
    assert.equal(reads.includes("gitSyncToken"), false);
    assert.deepEqual(JSON.parse(entries.get("_index") ?? "{}").keys, ["zoteroApiKey"]);
  });

  it("save writes a write-only entry but never lists it in the index", async () => {
    const { entries, keychain } = fakeKeychain({});
    const store = new DeviceSecretsStore(fakeRun([]).run, keychain);
    const secrets = { zoteroApiKey: "k", overleafToken: "t" } as unknown as Parameters<typeof store.save>[0];
    await store.save(secrets);
    assert.equal(entries.get("overleafToken"), "t");
    assert.deepEqual(JSON.parse(entries.get("_index") ?? "{}").keys, ["zoteroApiKey"]);
  });
});

const noMove = async () => undefined;
const noLegacy = async () => false;

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
    const store = new DeviceSecretsStore(fakeRun([]).run, keychain, noMove, noLegacy);
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
    const store = new DeviceSecretsStore(fakeRun([]).run, failing, noMove, noLegacy);
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
    const store = new DeviceSecretsStore(fakeRun([]).run, failing, noMove, noLegacy);
    await assert.rejects(() => store.save(flat({ a: "new", b: "x" })), (err: unknown) => {
      assert.ok(err instanceof PartialSaveError);
      assert.match(err.message, /: a \(/);
      return true;
    });
    assert.equal(entries.get("a"), "new");
  });

  it("refuses to save over a corrupt index, and writes nothing", async () => {
    const { entries, writes, keychain } = fakeKeychain({ "_index": "not json" });
    const store = new DeviceSecretsStore(fakeRun([]).run, keychain, noMove, noLegacy);
    await assert.rejects(() => store.save(flat({ zoteroApiKey: "k" })), KeychainIndexCorruptError);
    assert.deepEqual(writes, []);
    assert.equal(entries.get("_index"), "not json");
  });

  it("reports a corrupt index on load as well", async () => {
    const { keychain } = fakeKeychain({ "_index": "{\"keys\":\"nope\"}" });
    const store = new DeviceSecretsStore(fakeRun([]).run, keychain, noMove, noLegacy);
    await assert.rejects(() => store.load(), KeychainIndexCorruptError);
  });

  it("clears an unreadable index on reset, so a save can run again", async () => {
    const { entries, keychain } = fakeKeychain({ "_index": "not json" });
    const store = new DeviceSecretsStore(fakeRun([]).run, keychain, noMove, noLegacy);
    assert.equal(await store.resetCorruptIndex(), true);
    assert.equal(entries.has("_index"), false);
    await store.save(flat({ zoteroApiKey: "k" }));
    assert.equal(entries.get("zoteroApiKey"), "k");
  });

  it("leaves a readable index alone on reset", async () => {
    const { entries, keychain } = fakeKeychain({ "_index": indexOf(["zoteroApiKey"]), zoteroApiKey: "k" });
    const store = new DeviceSecretsStore(fakeRun([]).run, keychain, noMove, noLegacy);
    assert.equal(await store.resetCorruptIndex(), false);
    assert.equal(entries.get("_index"), indexOf(["zoteroApiKey"]));
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
