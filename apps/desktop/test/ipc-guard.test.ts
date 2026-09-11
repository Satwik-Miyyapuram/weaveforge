import assert from "node:assert/strict";
import test from "node:test";

import { registerGuardedIpc, sameOrigin, type IpcSurface } from "../src/ipc-guard";

/**
 * The rule that stands between a page and the shell's own channels.
 *
 * The navigation guard in `main.ts` is what normally keeps the window on the
 * app's origin, and it is tested by the app running. What is tested here is the
 * second line — the one that does not depend on the window having been pointed
 * anywhere in particular — because that is the whole reason it exists: the two
 * configurations that step around the navigation guard are both one build flag
 * away, and a page reached that way must not be able to ask for raw SQL.
 *
 * The fake `ipc` records what was registered so a refused call can be shown to
 * have reached no handler at all.
 */

const ORIGIN = "app://weaveforge";

interface Recorded {
  channel: string;
  listener: (event: unknown, ...args: unknown[]) => unknown;
}

function fakeIpc(): IpcSurface & { handled: Recorded[]; listened: Recorded[] } {
  const handled: Recorded[] = [];
  const listened: Recorded[] = [];
  return {
    handled,
    listened,
    handle(channel, listener) {
      handled.push({ channel, listener: listener as Recorded["listener"] });
    },
    on(channel, listener) {
      listened.push({ channel, listener: listener as Recorded["listener"] });
    },
  };
}

/** What Electron hands a handler, as little of it as this rule reads. */
const from = (url: string | undefined | null) => ({ senderFrame: url === null ? null : { url } });

test("ipc guard: a call from the app's own origin reaches the handler", async () => {
  const ipc = fakeIpc();
  registerGuardedIpc(ORIGIN, ipc).handle("weaveforge:db-query", () => "ran");

  assert.equal(ipc.handled.length, 1);
  const answer = await ipc.handled[0]?.listener(from(`${ORIGIN}/settings/index.html`), "select 1", []);
  assert.equal(answer, "ran");
});

test("ipc guard: the arguments a caller sent arrive unchanged", async () => {
  const ipc = fakeIpc();
  const seen: unknown[] = [];
  registerGuardedIpc(ORIGIN, ipc).handle("weaveforge:db-query", (_event, ...args) => {
    seen.push(...args);
    return null;
  });

  await ipc.handled[0]?.listener(from(`${ORIGIN}/`), "select $1", [1, "two", true, null]);
  assert.deepEqual(seen, ["select $1", [1, "two", true, null]]);
});

test("ipc guard: a foreign origin is refused, and the handler does not run", () => {
  const ipc = fakeIpc();
  let ran = false;
  registerGuardedIpc(ORIGIN, ipc).handle("weaveforge:db-query", () => {
    ran = true;
    return "ran";
  });

  // Captured rather than allowed to escape: `ipcMain.handle` is what turns this
  // into a rejected promise on the caller's side, and the assertion here is that
  // the rejection happened at all.
  let raised: unknown = null;
  try {
    ipc.handled[0]?.listener(from("https://evil.example/read-the-vault"));
  } catch (error) {
    raised = error;
  }

  assert.ok(raised instanceof Error, "a foreign origin must not be answered silently");
  assert.equal(ran, false, "the handler ran for a foreign origin");
});

test("ipc guard: each of the ways a frame can be wrong is refused", () => {
  for (const [what, event] of [
    ["no frame at all", {}],
    ["a frame that has gone away", from(null)],
    ["a frame with no url", from(undefined)],
    ["an empty url", from("")],
    ["an unparseable url", from("not a url")],
    ["a sibling origin", from("app://somewhereelse/")],
    ["a scheme that merely looks like the app's", from("app://weaveforge.evil.example/")],
    ["a different port", from("http://localhost:3001/")],
  ] as const) {
    const ipc = fakeIpc();
    let ran = false;
    registerGuardedIpc(ORIGIN, ipc).handle("weaveforge:secret-write", () => {
      ran = true;
    });

    assert.throws(() => ipc.handled[0]?.listener(event), what);
    assert.equal(ran, false, what);
  }
});

test("ipc guard: the origin is compared, not the path", () => {
  const ipc = fakeIpc();
  let ran = 0;
  registerGuardedIpc(ORIGIN, ipc).handle("weaveforge:vault-read", () => {
    ran += 1;
  });

  assert.doesNotThrow(() => ipc.handled[0]?.listener(from(`${ORIGIN}/anything/at/all?q=1#x`)));
  assert.doesNotThrow(() => ipc.handled[0]?.listener(from(`${ORIGIN.toUpperCase()}/`)));
  assert.equal(ran, 2, "same origin under a different path or case must still be the app");
});

test("ipc guard: an event channel is guarded the same way, and runs no listener", () => {
  const ipc = fakeIpc();
  const heard: unknown[][] = [];
  const guarded = registerGuardedIpc(ORIGIN, ipc);
  guarded.on("weaveforge:semantic-ranked", (_event, ...args) => {
    heard.push(args);
  });

  assert.equal(ipc.listened.length, 1);
  // Not raised, unlike `handle`: an event has no caller waiting for an answer,
  // and a throw here would surface as an unhandled error in the main process.
  assert.doesNotThrow(() => ipc.listened[0]?.listener(from("https://evil.example/"), 1, ["a"]));
  assert.deepEqual(heard, []);

  assert.doesNotThrow(() => ipc.listened[0]?.listener(from(`${ORIGIN}/`), 1, ["a"]));
  assert.deepEqual(heard, [[1, ["a"]]]);
});

test("ipc guard: a refusal is logged with the origin it came from", () => {
  const ipc = fakeIpc();
  const logged: string[] = [];
  const original = console.warn;
  console.warn = (...parts: unknown[]) => {
    logged.push(parts.join(" "));
  };
  try {
    registerGuardedIpc(ORIGIN, ipc).handle("weaveforge:db-query", () => null);
    assert.throws(() =>
      ipc.handled[0]?.listener(from("https://evil.example/steal?token=abc123")),
    );
  } finally {
    console.warn = original;
  }

  assert.equal(logged.length, 1);
  assert.match(logged[0] ?? "", /weaveforge:db-query/);
  assert.match(logged[0] ?? "", /https:\/\/evil\.example/);
  // The path and its query can carry a credential; the log gets the origin only.
  assert.equal(logged[0]?.includes("abc123"), false);
});

test("ipc guard: sameOrigin refuses what it cannot read", () => {
  assert.equal(sameOrigin("app://weaveforge/index.html", ORIGIN), true);
  assert.equal(sameOrigin("not a url", ORIGIN), false);
  assert.equal(sameOrigin("", ORIGIN), false);
  assert.equal(sameOrigin("https://weaveforge.example/", ORIGIN), false);
});

test("ipc guard: sameOrigin compares components, because URL.origin cannot", () => {
  // The reason this is not `new URL(url).origin === origin`: Node reports the
  // origin of a non-special scheme like `app://` as the string "null", while
  // the renderer's frame reports the real one. Comparing those would refuse
  // every legitimate call in the packaged app while passing every test written
  // against the packaged app's own constant.
  assert.equal(new URL("app://weaveforge/index.html").origin, "null");

  // Component-wise, the things that must match do.
  assert.equal(sameOrigin("https://app.example/settings", "https://app.example"), true);
  assert.equal(sameOrigin("https://app.example:443/settings", "https://app.example"), true);
  assert.equal(sameOrigin("http://localhost:3000/", "http://localhost:3000"), true);
  assert.equal(sameOrigin("https://app.example:444/", "https://app.example"), false);
  assert.equal(sameOrigin("http://app.example/", "https://app.example"), false);
  assert.equal(sameOrigin("https://sub.app.example/", "https://app.example"), false);
  // A trailing dot is a different hostname as far as this is concerned, which
  // is the safe direction to be wrong in.
  assert.equal(sameOrigin("https://app.example./", "https://app.example"), false);
});
