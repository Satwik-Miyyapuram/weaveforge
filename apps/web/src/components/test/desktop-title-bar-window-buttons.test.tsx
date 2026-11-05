/**
 * The Rust shell's window has no system frame on Windows and Linux, so the
 * title bar draws minimise, maximise and close itself and runs them through the
 * shell's Window menu ids. A shell without those ids (Electron, whose system
 * buttons sit over the bar) gets no buttons.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import type { DesktopMenuGroup } from "@/lib/desktop/desktop-bridge";
import { DesktopTitleBar } from "../desktop-title-bar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
const g = globalThis as { window?: unknown; document?: unknown };
const original = { window: g.window, document: g.document };
// desktop() accepts a bridge by its shape, so it needs fetchTitle.
const bridge: Record<string, unknown> = { fetchTitle: () => Promise.resolve(null) };
g.window = { weaveforge: bridge, addEventListener() {}, removeEventListener() {} };
g.document = { documentElement: { setAttribute() {}, removeAttribute() {} } };

after(() => {
  g.window = original.window;
  g.document = original.document;
});

const entry = (id: string, label: string) => ({ id, kind: "item", label, enabled: true }) as DesktopMenuGroup["items"][number];

function windowGroup(maximizeLabel: string, withButtons = true): DesktopMenuGroup[] {
  const items = [
    entry(withButtons ? "window:minimize" : "m.4.0", "Minimize"),
    entry("window:maximize", maximizeLabel),
    entry(withButtons ? "window:close" : "m.4.3", "Close window"),
  ];
  return [{ label: "Window", items }];
}

async function render(model: DesktopMenuGroup[]): Promise<{ tree: ReactTestRenderer; invoked: string[] }> {
  const invoked: string[] = [];
  bridge.menuModel = () => Promise.resolve(model);
  bridge.invokeMenuItem = (id: string) => {
    invoked.push(id);
    return Promise.resolve();
  };
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(createElement(AppRouterContext.Provider, { value: router as never }, createElement(DesktopTitleBar)));
  });
  await act(async () => {
    await Promise.resolve();
  });
  assert.ok(tree);
  return { tree, invoked };
}

const button = (tree: ReactTestRenderer, label: string) =>
  tree.root.find((node) => node.type === "button" && node.props["aria-label"] === label);

test("minimise, maximise and close run the shell's Window entries", async () => {
  const { tree, invoked } = await render(windowGroup("Maximize"));
  for (const label of ["Minimize", "Maximize", "Close"]) {
    await act(async () => button(tree, label).props.onClick());
  }
  assert.deepEqual(invoked, ["window:minimize", "window:maximize", "window:close"]);
  await act(async () => tree.unmount());
});

test("a maximised window offers Restore", async () => {
  const { tree } = await render(windowGroup("Restore"));
  assert.ok(button(tree, "Restore"));
  await act(async () => tree.unmount());
});

test("the empty part of the bar drags the window", async () => {
  const { tree } = await render(windowGroup("Maximize"));
  const regions = tree.root.findAll((node) => typeof node.type === "string" && node.props["data-tauri-drag-region"] !== undefined);
  assert.ok(regions.some((node) => String(node.props.className).includes("title-bar-drag")));
  await act(async () => tree.unmount());
});

test("a shell that draws its own window buttons gets none from the page", async () => {
  const { tree } = await render(windowGroup("Maximize", false));
  assert.equal(tree.root.findAll((node) => node.type === "button" && node.props["aria-label"] === "Close").length, 0);
  await act(async () => tree.unmount());
});
