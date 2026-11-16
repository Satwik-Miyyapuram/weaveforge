/**
 * The banner over the page: it appears for a ready release, installs only when
 * the button is pressed, "Later" hides that release, a failure is an alert with
 * a retry, and nothing renders without the shell's one-click API.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import "@/lib/test/react-harness";
import type { DesktopAppUpdate } from "@/lib/desktop/desktop-bridge";
import { AppUpdateNotice } from "../ui/app-update-notice";

const g = globalThis as { window?: unknown };
const original = g.window;
after(() => { g.window = original; });

type Calls = { status: number; check: number; install: number };

function stubWindow(initial: DesktopAppUpdate, actions: {
  install?: () => Promise<DesktopAppUpdate>;
  check?: () => Promise<DesktopAppUpdate>;
} = {}) {
  const calls: Calls = { status: 0, check: 0, install: 0 };
  let listener: ((s: DesktopAppUpdate) => void) | null = null;
  g.window = {
    weaveforge: {
      fetchTitle: () => Promise.resolve({}),
      version: initial.current,
      platform: "win32",
      appUpdateStatus: () => { calls.status += 1; return Promise.resolve(initial); },
      appUpdateCheck: () => { calls.check += 1; return (actions.check ?? (() => Promise.resolve(initial)))(); },
      appUpdateInstall: () => { calls.install += 1; return (actions.install ?? (() => Promise.resolve(initial)))(); },
      onAppUpdate: (cb: (s: DesktopAppUpdate) => void) => { listener = cb; return () => { listener = null; }; },
    },
  };
  return { calls, push: (s: DesktopAppUpdate) => listener?.(s) };
}

const status = (patch: Partial<DesktopAppUpdate>): DesktopAppUpdate => ({
  phase: "idle", current: "0.9.1", version: null, percent: null, error: null, ...patch,
});

const textOf = (node: ReactTestInstance): string =>
  node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
const buttonLabelled = (tree: ReactTestRenderer, label: string) =>
  tree.root.find((n) => n.type === "button" && textOf(n).trim() === label);
const findBanner = (tree: ReactTestRenderer) => tree.root.findAll((n) => n.props.className === "release-notice-banner");

async function mount(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(AppUpdateNotice));
    await new Promise((r) => setTimeout(r, 5));
  });
  return tree;
}

test("a ready release shows the notice with an install button and Later", async () => {
  stubWindow(status({ phase: "available", version: "0.9.2" }));
  const tree = await mount();
  const [banner] = findBanner(tree);
  assert.ok(banner, "the banner renders");
  assert.match(textOf(banner), /WeaveForge 0\.9\.2 is ready — Restart to update/);
  assert.ok(buttonLabelled(tree, "Update now"));
  assert.ok(buttonLabelled(tree, "Later"));
  await act(async () => tree.unmount());
});

test("pressing the install button calls the shell's install and shows its result", async () => {
  const installing = status({ phase: "installing", version: "0.9.2" });
  const { calls } = stubWindow(status({ phase: "available", version: "0.9.2" }), {
    install: () => Promise.resolve(installing),
  });
  const tree = await mount();
  await act(async () => buttonLabelled(tree, "Update now").props.onClick());
  assert.equal(calls.install, 1);
  assert.equal(calls.check, 0);
  assert.match(textOf(tree.root), /will restart/);
  await act(async () => tree.unmount());
});

test("Later hides the notice for that release", async () => {
  stubWindow(status({ phase: "available", version: "0.9.3" }));
  const tree = await mount();
  await act(async () => buttonLabelled(tree, "Later").props.onClick());
  assert.equal(findBanner(tree).length, 0);
  await act(async () => tree.unmount());
});

test("a failed install is an alert with a retry that installs again", async () => {
  const failed = status({ phase: "failed", version: "0.9.2", error: "The update did not install. Try again." });
  const { calls } = stubWindow(failed, { install: () => Promise.resolve(failed) });
  const tree = await mount();
  const banner = findBanner(tree)[0];
  assert.ok(banner, "the failed install shows a banner");
  assert.equal(banner.props.role, "alert");
  assert.match(textOf(banner), /did not install/);
  assert.match(textOf(banner), /The update did not install\. Try again\./);
  await act(async () => buttonLabelled(tree, "Try again").props.onClick());
  assert.equal(calls.install, 1);
  await act(async () => tree.unmount());
});

test("an unreachable shell is a retryable failure, never a stalled checking state", async () => {
  g.window = {
    weaveforge: {
      fetchTitle: () => Promise.resolve({}),
      version: "0.9.1",
      platform: "win32",
      appUpdateStatus: () => Promise.reject(new Error("ipc down")),
      onAppUpdate: () => () => undefined,
    },
  };
  const tree = await mount();
  const banner = findBanner(tree)[0];
  assert.ok(banner, "an unreachable shell shows a banner");
  assert.equal(banner.props.role, "alert");
  assert.match(textOf(banner), /Could not reach the updater\. Try again\./);
  await act(async () => tree.unmount());
});

test("an up-to-date shell shows nothing in the banner", async () => {
  stubWindow(status({ phase: "upToDate" }));
  const tree = await mount();
  assert.equal(findBanner(tree).length, 0);
  await act(async () => tree.unmount());
});

test("without the one-click API the banner renders nothing", async () => {
  g.window = {
    weaveforge: { fetchTitle: () => Promise.resolve({}), version: "0.5.2", platform: "win32", checkUpdate: () => Promise.resolve(null) },
  };
  const tree = await mount();
  assert.equal(tree.toJSON(), null);
  await act(async () => tree.unmount());
});

test("no bridge at all renders nothing", async () => {
  g.window = {};
  const tree = await mount();
  assert.equal(tree.toJSON(), null);
  await act(async () => tree.unmount());
});
