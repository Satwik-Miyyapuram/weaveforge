/**
 * The install gate shows its blocking screen when the shell says the gate is required, and when
 * the check fails. It renders nothing when the gate is not required (new installs).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import "@/lib/test/react-harness";
import { askInstallGate, INSTALL_GATE_TEXT, InstallGate } from "../ui/install-gate";

const textOf = (node: ReactTestInstance): string =>
  node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");

async function mount(check: () => Promise<boolean>): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(InstallGate, { check }));
    await new Promise((r) => setTimeout(r, 5));
  });
  return tree;
}

test("gate true renders the blocking screen with the exact text", async () => {
  const tree = await mount(() => Promise.resolve(true));
  const dialog = tree.root.find((n) => n.props.role === "alertdialog");
  assert.equal(textOf(dialog), INSTALL_GATE_TEXT);
  assert.equal(
    INSTALL_GATE_TEXT,
    "This update needs WeaveForge 0.9.7 first. Install 0.9.7, open it once so it moves your data to files, then install 0.9.8.",
  );
});

test("gate false renders nothing", async () => {
  const tree = await mount(() => Promise.resolve(false));
  assert.equal(tree.toJSON(), null);
});

test("a failed check renders the blocking screen", async () => {
  const tree = await mount(() => Promise.reject(new Error("device id unreadable")));
  const dialog = tree.root.find((n) => n.props.role === "alertdialog");
  assert.equal(textOf(dialog), INSTALL_GATE_TEXT);
});

/** Runs `fn` with `window.weaveforge` set to `bridge` (or absent when null), then restores it. */
async function withDesktop(bridge: Record<string, unknown> | null, fn: () => Promise<void>) {
  const g = globalThis as { window?: unknown };
  const before = g.window;
  g.window = bridge === null ? {} : { weaveforge: { fetchTitle: () => undefined, ...bridge } };
  try {
    await fn();
  } finally {
    g.window = before;
  }
}

test("browser (no desktop bridge) never shows the gate", async () => {
  await withDesktop(null, async () => {
    assert.equal(await askInstallGate(), false);
  });
});

test("desktop bridge without the installGateRequired member fails closed", async () => {
  await withDesktop({}, async () => {
    assert.equal(await askInstallGate(), true);
  });
});

test("desktop reads the shell's true and false answers", async () => {
  await withDesktop({ installGateRequired: () => Promise.resolve(true) }, async () => {
    assert.equal(await askInstallGate(), true);
  });
  await withDesktop({ installGateRequired: () => Promise.resolve(false) }, async () => {
    assert.equal(await askInstallGate(), false);
  });
});

test("a rejected shell check on desktop shows the gate", async () => {
  await withDesktop(
    { installGateRequired: () => Promise.reject(new Error("device id unreadable")) },
    async () => {
      assert.equal(await askInstallGate(), true);
    },
  );
});