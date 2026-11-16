/**
 * The recorder half of `boot-snapshot.tsx`: when the live screen is saved, and
 * when it must not be.
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { BOOT_SNAPSHOT_KEY } from "@/lib/boot-snapshot";
import { clearSessionCaches } from "@/lib/cache/parts";
import { markScreenShown } from "@/lib/screen-shown";
import { captureLayoutFrom, useBootSnapshotRecorder } from "../boot-snapshot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const g = globalThis as { window?: unknown; document?: unknown; sessionStorage?: unknown; localStorage?: unknown };
const hadWindow = "window" in g;
const realWindow = g.window;
const hadDocument = "document" in g;
const realDocument = g.document;

afterEach(() => {
  performance.clearMarks();
  if (hadWindow) g.window = realWindow;
  else delete g.window;
  delete g.sessionStorage;
  delete g.localStorage;
  if (hadDocument) g.document = realDocument;
  else delete g.document;
});

function setup(path = "/papers") {
  const map = new Map<string, string>([["thesis.projectId", "p1"]]);
  const win = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
    weaveforge: { fetchTitle: () => Promise.resolve({}) },
    location: { pathname: path },
    idle: null as null | (() => void),
    requestIdleCallback(fn: () => void) {
      win.idle = fn;
      return 1;
    },
    cancelIdleCallback() {
      win.idle = null;
    },
  });
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible", querySelectorAll: () => [] });
  g.window = win;
  g.sessionStorage = win.localStorage;
  g.localStorage = win.localStorage;
  g.document = doc;
  return { map, win, doc };
}

async function mountProbe(el: ReturnType<typeof createElement>) {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(el);
  });
  return tree!;
}

function Probe({ userId, capture }: { userId: string | null; capture: () => string | null }) {
  useBootSnapshotRecorder(userId, capture);
  return null;
}

test("sign-out with a save pending: nothing is written afterwards, even on pagehide", async () => {
  const { map, win } = setup();
  const tree = await mountProbe(createElement(Probe, { userId: "u1", capture: () => "<div>u1 screen</div>" }));
  await act(async () => markScreenShown("papers"));
  assert.ok(win.idle, "a save is waiting for idle");
  const idle = win.idle;
  clearSessionCaches();
  idle?.();
  win.dispatchEvent(new Event("pagehide"));
  assert.equal(map.has(BOOT_SNAPSHOT_KEY), false);
  await act(async () => tree.unmount());
});

test("a new user after sign-out records again", async () => {
  const { map, win } = setup();
  const capture = () => "<div>screen</div>";
  const tree = await mountProbe(createElement(Probe, { userId: "u1", capture }));
  clearSessionCaches();
  await act(async () => tree.update(createElement(Probe, { userId: null, capture })));
  await act(async () => tree.update(createElement(Probe, { userId: "u2", capture })));
  await act(async () => markScreenShown("papers"));
  win.dispatchEvent(new Event("pagehide"));
  assert.ok(map.has(BOOT_SNAPSHOT_KEY));
  await act(async () => tree.unmount());
});

test("closing on a route that never reported shown saves nothing", async () => {
  const { map, win } = setup("/papers");
  const tree = await mountProbe(createElement(Probe, { userId: "u1", capture: () => "<div>x</div>" }));
  await act(async () => markScreenShown("papers"));
  win.location.pathname = "/settings";
  win.dispatchEvent(new Event("pagehide"));
  assert.equal(map.has(BOOT_SNAPSHOT_KEY), false);
  win.location.pathname = "/papers";
  win.dispatchEvent(new Event("pagehide"));
  assert.ok(map.has(BOOT_SNAPSHOT_KEY));
  await act(async () => tree.unmount());
});

test("an unchanged path and markup is not written twice", async () => {
  const { map, win } = setup();
  const tree = await mountProbe(createElement(Probe, { userId: "u1", capture: () => "<div>same</div>" }));
  await act(async () => markScreenShown("papers"));
  win.dispatchEvent(new Event("pagehide"));
  assert.ok(map.get(BOOT_SNAPSHOT_KEY));
  map.delete(BOOT_SNAPSHOT_KEY);
  win.dispatchEvent(new Event("pagehide"));
  assert.equal(map.has(BOOT_SNAPSHOT_KEY), false, "skipped: same path and html");
  await act(async () => tree.unmount());
});

test("a screen shown before the recorder mounted still counts", async () => {
  const { map, win } = setup();
  markScreenShown("papers");
  const tree = await mountProbe(createElement(Probe, { userId: "u1", capture: () => "<div>late</div>" }));
  win.dispatchEvent(new Event("pagehide"));
  assert.ok(map.has(BOOT_SNAPSHOT_KEY));
  await act(async () => tree.unmount());
});

test("the copy skips hidden keep-alive hosts without cloning them", () => {
  const cloned: string[] = [];
  const node = (cls: string, attrs: Record<string, string>, kids: unknown[] = []) => ({
    nodeType: 1,
    childNodes: kids,
    matches: (sel: string) =>
      sel.includes(".keep-alive-host:not([data-shown])") && cls === "keep-alive-host" && !("data-shown" in attrs),
    cloneNode: () => {
      cloned.push(cls);
      return { classList: { remove() {} }, appendChild() {}, outerHTML: "<x/>" };
    },
  });
  const root = node("layout", {}, [
    node("keep-alive-host", {}, [node("deep", {})]),
    node("keep-alive-host", { "data-shown": "" }, []),
  ]);
  captureLayoutFrom(root as unknown as Element);
  assert.deepEqual(cloned, ["layout", "keep-alive-host"]);
});
