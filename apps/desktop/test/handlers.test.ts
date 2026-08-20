import test from "node:test";
import assert from "node:assert/strict";
import { exactBytes, handleFetchImage, handleFetchTitle, mayOpenExternally } from "../src/handlers";

/**
 * The desktop half of the two lookups.
 *
 * What may be fetched is decided by `fetch-for-paste` and tested there; these
 * cover the part this package adds — that a refusal crosses the IPC boundary as
 * data rather than as a thrown error, that a bad argument is refused before
 * anything leaves the machine, and that the bytes handed to the renderer are
 * the picture's and nothing else.
 */

/** Records anything that tries to leave, so a refusal can be shown to be early. */
function watchFetch() {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    calls.push(String(input));
    return Promise.resolve(new Response("should not happen", { status: 500 }));
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("a non-string argument is refused, and nothing is requested", async () => {
  // The renderer is a web page. Whatever it sends is an argument, not a string.
  const watch = watchFetch();
  try {
    for (const bad of [undefined, null, 42, { toString: () => "https://example.com/" }]) {
      const result = await handleFetchTitle(bad);
      assert.equal(result.ok, false);
      const image = await handleFetchImage(bad);
      assert.equal(image.ok, false);
    }
    assert.deepEqual(watch.calls, []);
  } finally {
    watch.restore();
  }
});

test("a refused address comes back as a message, not as a thrown error", async () => {
  // Thrown from `ipcMain.handle`, this would reach the renderer with Electron's
  // own prefix stapled to the front — and the paste code shows it to a person.
  const watch = watchFetch();
  try {
    const result = await handleFetchTitle("http://localhost:3000/admin");
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.message.length > 0);
    assert.deepEqual(watch.calls, []);
  } finally {
    watch.restore();
  }
});

test("the loopback guard is not a desktop exception", async () => {
  // The desktop app has no server to protect, but it does run on somebody's
  // machine — and a note that pastes an address is a note that can be shared.
  const watch = watchFetch();
  try {
    for (const address of [
      "http://127.0.0.1/",
      "http://[::1]/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.1/",
    ]) {
      const result = await handleFetchImage(address);
      assert.equal(result.ok, false, address);
    }
    assert.deepEqual(watch.calls, []);
  } finally {
    watch.restore();
  }
});

test("exactBytes copies the view and not the pool behind it", () => {
  const pool = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
  const view = pool.subarray(2, 5);
  const copied = new Uint8Array(exactBytes(view));
  assert.deepEqual([...copied], [1, 2, 3]);
  // And it is a copy: writing through the original must not reach the renderer.
  pool[3] = 42;
  assert.deepEqual([...copied], [1, 2, 3]);
});

test("only a web address may be handed to the operating system", () => {
  assert.equal(mayOpenExternally("https://example.com/paper"), true);
  assert.equal(mayOpenExternally("http://example.com/paper"), true);

  // Each of these would have `shell.openExternal` run something local.
  for (const hostile of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "vscode://file/etc/passwd",
    "ms-msdt:/id",
    "https://user:pass@example.com/",
    "not a url at all",
  ]) {
    assert.equal(mayOpenExternally(hostile), false, hostile);
  }
});
