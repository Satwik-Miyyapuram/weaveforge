import test from "node:test";
import assert from "node:assert/strict";
import { SecretStore, type SecretCrypto, type SecretFile } from "../src/secret-store";

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
