import test from "node:test";
import assert from "node:assert/strict";
import { SecretStore, pageSecrets, type SecretCrypto, type SecretFile } from "../src/secret-store";

/**
 * What is worth checking here is the policy, not the cipher.
 *
 * `safeStorage` is the operating system's, and testing it would be testing
 * Electron. What this file asserts is the part that could go wrong on our side
 * and would be a leaked credential if it did: that a machine with no keychain
 * is refused rather than downgraded, that a name we do not know is refused
 * rather than stored, and that what lands in the file is never the key as
 * typed.
 */

/** A stand-in that "encrypts" reversibly, so a plaintext leak is visible. */
function fakeCrypto(available = true): SecretCrypto & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isEncryptionAvailable: () => available,
    encryptString: (plain) => {
      calls.push(plain);
      return Buffer.from(`sealed:${plain}`, "utf8");
    },
    decryptString: (encrypted) => {
      const text = encrypted.toString("utf8");
      if (!text.startsWith("sealed:")) throw new Error("not ours");
      return text.slice("sealed:".length);
    },
  };
}

function memoryFile(initial: string | null = null): SecretFile & { contents: string | null } {
  const state = {
    contents: initial,
    read: async () => state.contents,
    write: async (contents: string) => {
      state.contents = contents;
    },
  };
  return state;
}

test("a known secret survives a round trip", async () => {
  const store = new SecretStore(fakeCrypto(), memoryFile());

  await store.write("ai-provider", "sk-live");

  assert.deepEqual(await store.read("ai-provider"), { ok: true, value: "sk-live" });
});

test("the secret never reaches the file as it was given", async () => {
  const file = memoryFile();

  await new SecretStore(fakeCrypto(), file).write("ai-provider", "sk-live");

  assert.ok(file.contents);
  assert.ok(!file.contents.includes("sk-live"));
});

test("a name the store does not know is refused, whatever is asked of it", async () => {
  const file = memoryFile();
  const store = new SecretStore(fakeCrypto(), file);

  for (const result of [
    await store.write("session-token", "anything"),
    await store.read("session-token"),
    await store.clear("session-token"),
  ]) {
    assert.equal(result.ok, false);
  }
  assert.equal(file.contents, null);
});

test("with no keychain a write is refused rather than downgraded", async () => {
  const crypto = fakeCrypto(false);
  const file = memoryFile();

  const result = await new SecretStore(crypto, file).write("ai-provider", "sk-live");

  assert.equal(result.ok, false);
  assert.equal(file.contents, null);
  assert.deepEqual(crypto.calls, []);
});

test("with no keychain a read is empty rather than a failure", async () => {
  const store = new SecretStore(fakeCrypto(false), memoryFile('{"ai-provider":"x"}'));

  assert.deepEqual(await store.read("ai-provider"), { ok: true, value: null });
});

test("a blob this machine cannot decrypt reads as nothing stored", async () => {
  const file = memoryFile(
    JSON.stringify({ "ai-provider": Buffer.from("someone else's", "utf8").toString("base64") }),
  );

  assert.deepEqual(await new SecretStore(fakeCrypto(), file).read("ai-provider"), {
    ok: true,
    value: null,
  });
});

test("an unreadable file reads as empty and is written over", async () => {
  const store = new SecretStore(fakeCrypto(), memoryFile("{ this is not json"));

  assert.deepEqual(await store.read("ai-provider"), { ok: true, value: null });
  assert.deepEqual(await store.write("ai-provider", "sk-live"), { ok: true, value: null });
  assert.deepEqual(await store.read("ai-provider"), { ok: true, value: "sk-live" });
});

test("forgetting works on a machine where remembering no longer does", async () => {
  const file = memoryFile();
  await new SecretStore(fakeCrypto(), file).write("ai-provider", "sk-live");

  const store = new SecretStore(fakeCrypto(false), file);

  assert.deepEqual(await store.clear("ai-provider"), { ok: true, value: null });
  assert.equal(file.contents, "{}");
});

test("an empty value is refused", async () => {
  const result = await new SecretStore(fakeCrypto(), memoryFile()).write("ai-provider", "");

  assert.equal(result.ok, false);
});

// ------------------------------------------------------------ concurrent writes

/**
 * A file with a real gap between its read and its write.
 *
 * Without the gap, every write's read-modify-write cycle finishes in one
 * microtask and the cycles cannot interleave — so a test would pass whether or
 * not writes were serialised at all.
 */
function slowFile(initial: string | null = null) {
  const state = { contents: initial };
  const disk: SecretFile = {
    async read() {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return state.contents;
    },
    async write(contents: string) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      state.contents = contents;
    },
  };
  return { disk, state };
}

test("two secrets written at once both survive", async () => {
  const { disk } = slowFile();
  const store = new SecretStore(fakeCrypto(), disk);

  await Promise.all([
    store.write("ai-provider", "sk-live"),
    store.write("overleaf-token", "ol-live"),
    store.write("local-api-token", "local-live"),
  ]);

  // This is the finding, in the form that matters: a clobbered write here is a
  // credential the reader typed that is silently gone at the next launch.
  assert.deepEqual(await store.read("ai-provider"), { ok: true, value: "sk-live" });
  assert.deepEqual(await store.read("overleaf-token"), { ok: true, value: "ol-live" });
  assert.deepEqual(await store.read("local-api-token"), { ok: true, value: "local-live" });
});

test("forgetting one secret does not resurrect or drop another written at the same time", async () => {
  const { disk } = slowFile();
  const store = new SecretStore(fakeCrypto(), disk);
  await store.write("ai-provider", "sk-live");

  await Promise.all([store.clear("ai-provider"), store.write("overleaf-token", "ol-live")]);

  assert.deepEqual(await store.read("ai-provider"), { ok: true, value: null });
  assert.deepEqual(await store.read("overleaf-token"), { ok: true, value: "ol-live" });
});

// The page's view of the keychain (B01: xipc-01, xipc-02). The shell reads
// and writes every secret itself; the page may only touch its own.

function seededStore() {
  const crypto = fakeCrypto();
  const file = memoryFile();
  return { store: new SecretStore(crypto, file), file };
}

test("the page reads its own AI provider key", async () => {
  const { store } = seededStore();
  await store.write("ai-provider", "sk-page");
  assert.deepEqual(await pageSecrets(store).read("ai-provider"), { ok: true, value: "sk-page" });
});

test("the page cannot read the local API token hashes", async () => {
  const { store } = seededStore();
  await store.write("local-api-token", "[\"hash\"]");
  const result = await pageSecrets(store).read("local-api-token");
  assert.equal(result.ok, false);
  // The shell still can: main-local-api.ts reads it through the store itself.
  assert.deepEqual(await store.read("local-api-token"), { ok: true, value: "[\"hash\"]" });
});

test("the page cannot read the Overleaf token back", async () => {
  const { store } = seededStore();
  await store.write("overleaf-token", "olp_secret");
  assert.equal((await pageSecrets(store).read("overleaf-token")).ok, false);
});

test("the page may store and forget the Overleaf token", async () => {
  const { store } = seededStore();
  const page = pageSecrets(store);
  assert.deepEqual(await page.write("overleaf-token", "olp_new"), { ok: true, value: null });
  assert.deepEqual(await store.read("overleaf-token"), { ok: true, value: "olp_new" });
  assert.deepEqual(await page.clear("overleaf-token"), { ok: true, value: null });
  assert.deepEqual(await store.read("overleaf-token"), { ok: true, value: null });
});

test("the page cannot overwrite or clear the local API token", async () => {
  const { store, file } = seededStore();
  await store.write("local-api-token", "[\"real\"]");
  const before = file.contents;
  const page = pageSecrets(store);

  assert.equal((await page.write("local-api-token", "[\"forged\"]")).ok, false);
  assert.equal((await page.clear("local-api-token")).ok, false);
  assert.equal(file.contents, before, "nothing on disk changed");
  assert.deepEqual(await store.read("local-api-token"), { ok: true, value: "[\"real\"]" });
});

test("the page is refused names nobody stores, and non-strings", async () => {
  const { store } = seededStore();
  const page = pageSecrets(store);
  for (const name of ["vault-root", "", "__proto__", "AI-PROVIDER", 42, null, undefined]) {
    assert.equal((await page.read(name)).ok, false, `read ${String(name)}`);
    assert.equal((await page.write(name, "x")).ok, false, `write ${String(name)}`);
    assert.equal((await page.clear(name)).ok, false, `clear ${String(name)}`);
  }
});

test("the page's own write still goes through the store's checks", async () => {
  const { store } = seededStore();
  // An empty value is refused by the store, not waved through by the wrapper.
  assert.equal((await pageSecrets(store).write("ai-provider", "")).ok, false);
  const locked = new SecretStore(fakeCrypto(false), memoryFile());
  assert.equal((await pageSecrets(locked).write("ai-provider", "sk")).ok, false);
});

// ------------------------------------------------------------ read errors (38-02)

function failingFile(code: string): SecretFile & { writes: number } {
  const state = {
    writes: 0,
    read: async (): Promise<string | null> => {
      throw Object.assign(new Error(`${code}: operation not permitted`), { code });
    },
    write: async () => {
      state.writes += 1;
    },
  };
  return state;
}

test("a file that cannot be read right now refuses the write and keeps the other secrets", async () => {
  const file = failingFile("EPERM");
  const result = await new SecretStore(fakeCrypto(), file).write("ai-provider", "sk-live");

  assert.equal(result.ok, false);
  assert.equal(file.writes, 0);
});

test("a file that cannot be read right now refuses the clear", async () => {
  const file = failingFile("EBUSY");
  const result = await new SecretStore(fakeCrypto(), file).clear("ai-provider");

  assert.equal(result.ok, false);
  assert.equal(file.writes, 0);
});

test("a file that cannot be read right now reads as nothing stored", async () => {
  const file = failingFile("EBUSY");
  assert.deepEqual(await new SecretStore(fakeCrypto(), file).read("ai-provider"), {
    ok: true,
    value: null,
  });
});

// ------------------------------------------------------------ messages (xipc-23)

test("an empty value is refused for being empty, not for its name", async () => {
  const result = await new SecretStore(fakeCrypto(), memoryFile()).write("ai-provider", "");

  assert.equal(result.ok, false);
  assert.doesNotMatch(result.ok ? "" : result.message, /not something this app stores/);
});
