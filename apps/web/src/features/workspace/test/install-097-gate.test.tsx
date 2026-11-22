/**
 * The install gate: with an old database present and no verified 0.9.7 report it blocks the app
 * and renders none of the children; otherwise the children mount. The gate only reads the bridge.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import "@/lib/test/react-harness";
import { INSTALL_097_NOTICE, INSTALL_097_URL } from "../application/install-097-guard";
import { Install097Gate } from "../ui/install-097-gate";

const g = globalThis as { window?: unknown };
const original = g.window;
after(() => { g.window = original; });

/** Bridge stub: the gate's three reads default to "no folder" and a dismissed picker. */
function stubBridge(bridge: Record<string, unknown>) {
  g.window = {
    weaveforge: {
      fetchTitle: () => Promise.resolve({}),
      vaultRoot: () => Promise.resolve(null),
      chooseVaultRoot: () => Promise.resolve(null),
      ...bridge,
    },
  };
}

const textOf = (node: ReactTestInstance): string =>
  node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");

const CHILD_MARK = "APP-BEHIND-GATE";
function Child() {
  return createElement("div", null, CHILD_MARK);
}

const childCount = (tree: ReactTestRenderer) => tree.root.findAll((n) => n.type === Child).length;

function buttonWith(tree: ReactTestRenderer, label: string): ReactTestInstance {
  const found = tree.root.findAll((n) => n.type === "button" && textOf(n).includes(label));
  const only = found[0];
  if (found.length !== 1 || !only) throw new Error(`expected one button labelled "${label}"`);
  return only;
}

async function mount(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(Install097Gate, null, createElement(Child)));
    await new Promise((r) => setTimeout(r, 5));
  });
  return tree;
}

async function press(button: ReactTestInstance) {
  await act(async () => {
    button.props.onClick();
    await new Promise((r) => setTimeout(r, 5));
  });
}

test("unverified: old DB present, report not verified -> notice, download link and picker; no children", async () => {
  stubBridge({
    vaultRoot: () => Promise.resolve({ path: "/ws/old" }),
    legacyDbPresent: () => Promise.resolve(true),
    migrationReportVerified: () => Promise.resolve(false),
  });
  const tree = await mount();
  const text = textOf(tree.root);
  assert.ok(text.includes(INSTALL_097_NOTICE.title));
  assert.ok(text.includes(INSTALL_097_NOTICE.body));
  assert.equal(childCount(tree), 0, "app must not mount behind the gate");
  assert.ok(!text.includes(CHILD_MARK));
  const link = tree.root.findAll((n) => n.type === "a" && n.props.href === INSTALL_097_URL);
  const anchor = link[0];
  if (link.length !== 1 || !anchor) throw new Error("expected one download link");
  assert.equal(anchor.props.target, "_blank");
  assert.equal(anchor.props.rel, "noopener noreferrer");
  buttonWith(tree, "Choose the folder you exported to");
  tree.unmount();
});

test("unverified: the report is checked against the workspace folder", async () => {
  const calls: string[] = [];
  stubBridge({
    vaultRoot: () => Promise.resolve({ path: "/ws/old" }),
    legacyDbPresent: () => Promise.resolve(true),
    migrationReportVerified: (folder: string) => {
      calls.push(folder);
      return Promise.resolve(false);
    },
  });
  const tree = await mount();
  assert.deepEqual(calls, ["/ws/old"]);
  tree.unmount();
});

test("unverified: no folder known -> picker without asking the report", async () => {
  let asked = 0;
  stubBridge({
    legacyDbPresent: () => Promise.resolve(true),
    migrationReportVerified: () => {
      asked += 1;
      return Promise.resolve(true);
    },
  });
  const tree = await mount();
  assert.equal(asked, 0);
  assert.equal(childCount(tree), 0);
  buttonWith(tree, "Choose the folder you exported to");
  tree.unmount();
});

test("picker: the chosen export folder is checked and, once verified, the app mounts", async () => {
  const calls: string[] = [];
  stubBridge({
    vaultRoot: () => Promise.resolve({ path: "/ws/old" }),
    legacyDbPresent: () => Promise.resolve(true),
    migrationReportVerified: (folder: string) => {
      calls.push(folder);
      return Promise.resolve(folder === "/ws/moved");
    },
    chooseVaultRoot: () => Promise.resolve({ path: "/ws/moved" }),
  });
  const tree = await mount();
  assert.equal(childCount(tree), 0);
  await press(buttonWith(tree, "Choose the folder you exported to"));
  assert.deepEqual(calls, ["/ws/old", "/ws/moved"]);
  assert.equal(childCount(tree), 1, "app mounts once the chosen folder verifies");
  tree.unmount();
});

test("picker: a dismissed dialog keeps the gate and asks nothing more", async () => {
  let asked = 0;
  stubBridge({
    vaultRoot: () => Promise.resolve({ path: "/ws/old" }),
    legacyDbPresent: () => Promise.resolve(true),
    migrationReportVerified: () => {
      asked += 1;
      return Promise.resolve(false);
    },
    chooseVaultRoot: () => Promise.resolve(null),
  });
  const tree = await mount();
  await press(buttonWith(tree, "Choose the folder you exported to"));
  assert.equal(asked, 1);
  assert.equal(childCount(tree), 0);
  assert.ok(textOf(tree.root).includes(INSTALL_097_NOTICE.title));
  tree.unmount();
});

test("picker: a picker that throws shows the error code with retry", async () => {
  stubBridge({
    vaultRoot: () => Promise.resolve({ path: "/ws/old" }),
    legacyDbPresent: () => Promise.resolve(true),
    migrationReportVerified: () => Promise.resolve(false),
    chooseVaultRoot: () => Promise.reject(new Error("dialog broke")),
  });
  const tree = await mount();
  await press(buttonWith(tree, "Choose the folder you exported to"));
  assert.equal(childCount(tree), 0);
  assert.ok(textOf(tree.root).includes("PICK_FAILED"));
  buttonWith(tree, "Try again");
  tree.unmount();
});

test("passes: old DB absent -> children mount, no notice", async () => {
  stubBridge({ legacyDbPresent: () => Promise.resolve(false) });
  const tree = await mount();
  assert.equal(childCount(tree), 1, "app mounts");
  assert.ok(!textOf(tree.root).includes(INSTALL_097_NOTICE.title));
  tree.unmount();
});

test("passes: old DB present and verified report -> children mount", async () => {
  stubBridge({
    vaultRoot: () => Promise.resolve({ path: "/ws/old" }),
    legacyDbPresent: () => Promise.resolve(true),
    migrationReportVerified: () => Promise.resolve(true),
  });
  const tree = await mount();
  assert.equal(childCount(tree), 1);
  tree.unmount();
});

test("passes: browser (no desktop bridge) -> children mount at once", async () => {
  g.window = undefined;
  const tree = await mount();
  assert.equal(childCount(tree), 1);
  tree.unmount();
});

test("unknown: legacy check rejects -> CHECK code shown with retry, no children", async () => {
  stubBridge({ legacyDbPresent: () => Promise.reject(new Error("ipc down")) });
  const tree = await mount();
  assert.equal(childCount(tree), 0);
  const text = textOf(tree.root);
  assert.ok(text.includes("LEGACY_CHECK_FAILED"));
  assert.ok(!text.includes(INSTALL_097_NOTICE.title), "unknown is not the install notice");
  buttonWith(tree, "Try again");
  tree.unmount();
});

test("unknown: desktop shell without legacyDbPresent -> LEGACY_CHECK_UNAVAILABLE", async () => {
  stubBridge({});
  const tree = await mount();
  assert.equal(childCount(tree), 0);
  assert.ok(textOf(tree.root).includes("LEGACY_CHECK_UNAVAILABLE"));
  tree.unmount();
});

test("unknown: report check throws -> REPORT_CHECK_FAILED, no children", async () => {
  stubBridge({
    vaultRoot: () => Promise.resolve({ path: "/ws/old" }),
    legacyDbPresent: () => Promise.resolve(true),
    migrationReportVerified: () => Promise.reject(new Error("bridge down")),
  });
  const tree = await mount();
  assert.equal(childCount(tree), 0);
  assert.ok(textOf(tree.root).includes("REPORT_CHECK_FAILED"));
  tree.unmount();
});

test("unknown: report method absent while old DB present -> REPORT_CHECK_UNAVAILABLE", async () => {
  stubBridge({
    vaultRoot: () => Promise.resolve({ path: "/ws/old" }),
    legacyDbPresent: () => Promise.resolve(true),
  });
  const tree = await mount();
  assert.equal(childCount(tree), 0);
  assert.ok(textOf(tree.root).includes("REPORT_CHECK_UNAVAILABLE"));
  tree.unmount();
});

test("unknown: check never answers -> CHECK_TIMEOUT after the timeout", async () => {
  stubBridge({ legacyDbPresent: () => new Promise(() => {}) });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(Install097Gate, { checkTimeoutMs: 10, children: createElement(Child) }));
  });
  // The timeout starts when the effect flushes at the end of act, so wait in a second act.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  assert.equal(childCount(tree), 0);
  assert.ok(textOf(tree.root).includes("CHECK_TIMEOUT"));
  tree.unmount();
});

test("retry re-runs the check and mounts the app once it passes", async () => {
  let failing = true;
  stubBridge({
    legacyDbPresent: () => (failing ? Promise.reject(new Error("ipc down")) : Promise.resolve(false)),
  });
  const tree = await mount();
  assert.equal(childCount(tree), 0);
  failing = false;
  await press(buttonWith(tree, "Try again"));
  assert.equal(childCount(tree), 1);
  tree.unmount();
});
