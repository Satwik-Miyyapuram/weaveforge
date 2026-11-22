/**
 * The release-notice banner keeps its "seen" state on this device (localStorage), never on the
 * account: dismissing hides it, the choice survives a reload, a newer notice shows again, and no
 * account (`user_settings`) call is made.
 */
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import "@/lib/test/react-harness";
import { setContainerForTests } from "@/bootstrap";
import type { ReleaseNotice } from "@/features/settings/infrastructure/parts";
import { ReleaseNoticeBanner } from "../ui/release-notice-banner";

const SEEN_KEY = "wf.releaseNotice.seen";

const g = globalThis as { localStorage?: unknown };
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
after(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else delete g.localStorage;
  setContainerForTests(null);
});

/** An in-memory stand-in for `window.localStorage`; survives unmount, like a reload would. */
let store: Map<string, string>;
let throwOnAccess: boolean;
let calls: string[];

beforeEach(() => {
  store = new Map();
  throwOnAccess = false;
  calls = [];
  const storage = {
    getItem: (k: string) => {
      if (throwOnAccess) throw new Error("storage blocked");
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (throwOnAccess) throw new Error("storage blocked");
      store.set(k, v);
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
});

const notice: ReleaseNotice = {
  version: "0.9.7",
  title: "WeaveForge 0.9.7",
  body: "Your data is now files.",
  publishedAt: "2026-11-23T00:00:00Z",
};

/** A container whose account-side calls are recorded, so any `user_settings` use shows up. */
function stubContainer(latest: ReleaseNotice | null) {
  const record = (name: string) => async () => {
    calls.push(name);
    return null;
  };
  setContainerForTests({
    settings: {
      releaseNotices: {
        latest: async () => {
          calls.push("latest");
          return latest;
        },
        unseen: record("unseen"),
      },
      preferences: { saveNoticeSeen: record("saveNoticeSeen") },
    },
  } as unknown as Parameters<typeof setContainerForTests>[0]);
}

const textOf = (node: ReactTestInstance): string =>
  node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");

const banners = (tree: ReactTestRenderer) =>
  tree.root.findAll((n) => n.props.className === "release-notice-banner");

async function mount(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(ReleaseNoticeBanner));
    await new Promise((r) => setTimeout(r, 5));
  });
  return tree;
}

async function dismiss(tree: ReactTestRenderer): Promise<void> {
  const button = tree.root.findAll(
    (n) => typeof n.props.onClick === "function" && textOf(n) === "Dismiss",
  )[0];
  assert.ok(button, "the banner has a Dismiss button");
  await act(async () => button.props.onClick());
}

test("a notice the device has not dismissed shows", async () => {
  stubContainer(notice);
  const tree = await mount();
  const [banner] = banners(tree);
  assert.ok(banner, "the banner renders");
  assert.match(textOf(banner), /WeaveForge 0\.9\.7/);
  assert.match(textOf(banner), /Your data is now files\./);
  await act(async () => tree.unmount());
});

test("dismissing hides the banner and records the version on this device", async () => {
  stubContainer(notice);
  const tree = await mount();
  await dismiss(tree);
  assert.equal(banners(tree).length, 0);
  assert.equal(store.get(SEEN_KEY), "0.9.7");
  await act(async () => tree.unmount());
});

test("the dismissal survives a reload", async () => {
  stubContainer(notice);
  const first = await mount();
  await dismiss(first);
  await act(async () => first.unmount());

  const reloaded = await mount();
  assert.equal(banners(reloaded).length, 0);
  await act(async () => reloaded.unmount());
});

test("a newer notice shows again after an older one was dismissed here", async () => {
  store.set(SEEN_KEY, "0.9.6");
  stubContainer(notice);
  const tree = await mount();
  assert.equal(banners(tree).length, 1);
  await act(async () => tree.unmount());
});

test("the whole flow makes no account (user_settings) call", async () => {
  stubContainer(notice);
  const tree = await mount();
  await dismiss(tree);
  await act(async () => tree.unmount());
  const reloaded = await mount();
  await act(async () => reloaded.unmount());
  assert.deepEqual(calls, ["latest", "latest"]);
});

test("with storage blocked the banner still shows and dismisses without throwing", async () => {
  throwOnAccess = true;
  stubContainer(notice);
  const tree = await mount();
  assert.equal(banners(tree).length, 1);
  await dismiss(tree);
  assert.equal(banners(tree).length, 0);
  await act(async () => tree.unmount());
});

test("no notice means no banner", async () => {
  stubContainer(null);
  const tree = await mount();
  assert.equal(banners(tree).length, 0);
  await act(async () => tree.unmount());
});
