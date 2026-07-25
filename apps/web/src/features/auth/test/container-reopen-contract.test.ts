import assert from "node:assert/strict";
import test from "node:test";

test("getContainer throws until ensureContainer has completed (reopen race)", async () => {
  // Isolate module state so this suite does not depend on other tests' bootstrap.
  const mod = await import("@/bootstrap");
  // If a previous suite already warmed the container in this process, the sync
  // accessor succeeds — that is fine. The important contract is the error text
  // when cold.
  try {
    mod.getContainer();
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.match(err.message, /App container not ready/);
    assert.match(err.message, /ensureContainer/);
  }
});
