/**
 * The boot snapshot (`boot-snapshot.ts`): the last screen's markup, kept on
 * this device so a cold start can paint it before the core and the database
 * are up. A miss is always safe; a wrong hit is not, so every doubt reads as
 * a miss.
 */
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  BOOT_SNAPSHOT_KEY,
  MAX_SNAPSHOT_HTML,
  forgetBootSnapshot,
  readBootSnapshot,
  saveBootSnapshot,
  screenPath,
  styleBuildKey,
} from "../boot-snapshot";

const g = globalThis as { window?: unknown };
const hadWindow = "window" in g;
const realWindow = g.window;

afterEach(() => {
  if (hadWindow) g.window = realWindow;
  else delete g.window;
});

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

/** The desktop app: a bridge on `window`. */
function app(storage = memoryStorage()) {
  g.window = { localStorage: storage, weaveforge: { fetchTitle: () => Promise.resolve({}) } };
  return storage;
}

const at = { build: "b1", userId: "u1", projectId: "p1" };

test("boot snapshot: reads back the screen it saved", () => {
  app();
  assert.equal(saveBootSnapshot({ ...at, path: "/papers", html: "<div>papers</div>" }), true);
  assert.deepEqual(readBootSnapshot({ build: "b1", projectId: "p1", path: "/papers" }), {
    html: "<div>papers</div>",
    userId: "u1",
  });
});

test("boot snapshot: nothing saved, or another screen, is a miss", () => {
  app();
  assert.equal(readBootSnapshot({ build: "b1", projectId: "p1", path: "/papers" }), null);
  saveBootSnapshot({ ...at, path: "/papers", html: "<div>papers</div>" });
  assert.equal(readBootSnapshot({ build: "b1", projectId: "p1", path: "/notes" }), null);
});

test("boot snapshot: a trailing slash and the root name the same screen", () => {
  app();
  saveBootSnapshot({ ...at, path: "/papers/", html: "<div>papers</div>" });
  assert.ok(readBootSnapshot({ build: "b1", projectId: "p1", path: "/papers" }));
  saveBootSnapshot({ ...at, path: "/dashboard", html: "<div>home</div>" });
  // The app opens at `/`, which goes straight to the dashboard.
  assert.equal(readBootSnapshot({ build: "b1", projectId: "p1", path: "/" })?.html, "<div>home</div>");
  assert.equal(screenPath(""), "/dashboard");
});

test("boot snapshot: a new version of the app (other stylesheets) is a miss", () => {
  app();
  saveBootSnapshot({ ...at, path: "/papers", html: "<div>papers</div>" });
  assert.equal(readBootSnapshot({ build: "b2", projectId: "p1", path: "/papers" }), null);
});

test("boot snapshot: another project is a miss", () => {
  app();
  saveBootSnapshot({ ...at, path: "/papers", html: "<div>papers</div>" });
  assert.equal(readBootSnapshot({ build: "b1", projectId: "p2", path: "/papers" }), null);
  assert.equal(readBootSnapshot({ build: "b1", projectId: null, path: "/papers" }), null);
});

test("boot snapshot: broken or foreign data reads as a miss, never throws", () => {
  const storage = app();
  for (const raw of [
    "{not json",
    "null",
    "[]",
    JSON.stringify({ v: 1, value: { v: 999, build: "b1", userId: "u1", projectId: "p1", screens: [] } }),
    JSON.stringify({ v: 1, value: { v: 1, build: "b1", userId: "u1", projectId: "p1", screens: "x" } }),
    JSON.stringify({ v: 1, value: { v: 1, build: "b1", userId: 7, projectId: "p1", screens: [] } }),
    JSON.stringify({
      v: 1,
      value: { v: 1, build: "b1", userId: "u1", projectId: "p1", screens: [{ path: "/papers", html: 5 }] },
    }),
  ]) {
    storage.map.set(BOOT_SNAPSHOT_KEY, raw);
    assert.equal(readBootSnapshot({ build: "b1", projectId: "p1", path: "/papers" }), null, raw);
  }
});

test("boot snapshot: another user's or project's save starts over", () => {
  app();
  saveBootSnapshot({ ...at, path: "/papers", html: "<div>u1</div>" });
  saveBootSnapshot({ ...at, userId: "u2", path: "/notes", html: "<div>u2</div>" });
  assert.equal(readBootSnapshot({ build: "b1", projectId: "p1", path: "/papers" }), null, "u1's screen gone");
  assert.equal(readBootSnapshot({ build: "b1", projectId: "p1", path: "/notes" })?.userId, "u2");
});

test("boot snapshot: keeps the three most recent screens", () => {
  app();
  for (const path of ["/a", "/b", "/c", "/d"]) saveBootSnapshot({ ...at, path, html: `<p>${path}</p>` });
  assert.equal(readBootSnapshot({ build: "b1", projectId: "p1", path: "/a" }), null);
  for (const path of ["/b", "/c", "/d"]) assert.ok(readBootSnapshot({ build: "b1", projectId: "p1", path }), path);
  // Saving a kept one again makes it the newest.
  saveBootSnapshot({ ...at, path: "/b", html: "<p>b2</p>" });
  saveBootSnapshot({ ...at, path: "/e", html: "<p>e</p>" });
  assert.equal(readBootSnapshot({ build: "b1", projectId: "p1", path: "/c" }), null);
  assert.equal(readBootSnapshot({ build: "b1", projectId: "p1", path: "/b" })?.html, "<p>b2</p>");
});

test("boot snapshot: a screen over the size cap is not kept, and drops its stale copy", () => {
  app();
  saveBootSnapshot({ ...at, path: "/papers", html: "<p>small</p>" });
  assert.equal(saveBootSnapshot({ ...at, path: "/papers", html: "x".repeat(MAX_SNAPSHOT_HTML + 1) }), false);
  assert.equal(readBootSnapshot({ build: "b1", projectId: "p1", path: "/papers" }), null);
});

test("boot snapshot: forget removes it", () => {
  const storage = app();
  saveBootSnapshot({ ...at, path: "/papers", html: "<p>x</p>" });
  forgetBootSnapshot();
  assert.equal(storage.map.has(BOOT_SNAPSHOT_KEY), false);
});

test("boot snapshot: its key is one sign-out wipes (weaveforge.)", () => {
  assert.ok(BOOT_SNAPSHOT_KEY.startsWith("weaveforge."));
});

test("boot snapshot: off in a browser, where account data must not outlive the session", () => {
  const storage = memoryStorage();
  g.window = { localStorage: storage };
  assert.equal(saveBootSnapshot({ ...at, path: "/papers", html: "<p>x</p>" }), false);
  assert.equal(storage.map.size, 0);
  assert.equal(readBootSnapshot({ build: "b1", projectId: "p1", path: "/papers" }), null);
});

test("styleBuildKey: changes when a stylesheet changes, stable otherwise", () => {
  const a = styleBuildKey(["/_next/static/css/a1.css", "/_next/static/css/b1.css"]);
  assert.equal(a, styleBuildKey(["/_next/static/css/a1.css", "/_next/static/css/b1.css"]));
  assert.notEqual(a, styleBuildKey(["/_next/static/css/a2.css", "/_next/static/css/b1.css"]));
  assert.ok(a.length < 40, "short");
});
