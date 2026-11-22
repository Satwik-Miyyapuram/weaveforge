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
  KeychainUnavailableError,
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
        assert.match(err.message, /sudo apt install gnome-keyring libsecret-1-0/);
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
