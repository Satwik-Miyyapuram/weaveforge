import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSessionKeychainStorage,
  sessionSecretName,
  type SecretPort,
} from "../session-keychain-storage";

function memoryPort(): SecretPort & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: async (name) => values.get(name) ?? null,
    set: async (name, value) => {
      values.set(name, value);
    },
    remove: async (name) => {
      values.delete(name);
    },
  };
}

describe("sessionSecretName", () => {
  it("uses the session:<profileId> name from modes-093 section 5", () => {
    assert.equal(sessionSecretName("prof-1"), "session:prof-1");
  });
});

describe("createSessionKeychainStorage", () => {
  it("returns null for a key never written", async () => {
    const storage = createSessionKeychainStorage(memoryPort(), "p1");
    assert.equal(await storage.getItem("sb-x-auth-token"), null);
  });

  it("stores each supabase key inside the one profile secret", async () => {
    const port = memoryPort();
    const storage = createSessionKeychainStorage(port, "p1");
    await storage.setItem("sb-x-auth-token", "tok");
    await storage.setItem("sb-x-code-verifier", "ver");
    assert.equal(await storage.getItem("sb-x-auth-token"), "tok");
    assert.equal(await storage.getItem("sb-x-code-verifier"), "ver");
    assert.deepEqual([...port.values.keys()], ["session:p1"]);
  });

  it("keeps sessions of two profiles apart", async () => {
    const port = memoryPort();
    await createSessionKeychainStorage(port, "a").setItem("k", "from-a");
    assert.equal(await createSessionKeychainStorage(port, "b").getItem("k"), null);
  });

  it("removeItem drops one key and leaves the others", async () => {
    const port = memoryPort();
    const storage = createSessionKeychainStorage(port, "p1");
    await storage.setItem("a", "1");
    await storage.setItem("b", "2");
    await storage.removeItem("a");
    assert.equal(await storage.getItem("a"), null);
    assert.equal(await storage.getItem("b"), "2");
  });

  it("removeItem on the last key deletes the secret", async () => {
    const port = memoryPort();
    const storage = createSessionKeychainStorage(port, "p1");
    await storage.setItem("a", "1");
    await storage.removeItem("a");
    assert.equal(port.values.has("session:p1"), false);
  });

  it("treats a corrupt stored value as empty instead of throwing", async () => {
    const port = memoryPort();
    port.values.set("session:p1", "not json");
    const storage = createSessionKeychainStorage(port, "p1");
    assert.equal(await storage.getItem("a"), null);
    await storage.setItem("a", "1");
    assert.equal(await storage.getItem("a"), "1");
  });
});
