/**
 * The install gate: with an old database present and no verified 0.9.7 report it blocks the app
 * and renders none of the children; otherwise the children mount. The gate only reads the bridge.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import "@/lib/test/react-harness";
import { INSTALL_097_NOTICE, INSTALL_097_URL, INSTALL_097_WEB_NOTICE } from "../application/install-097-guard";
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
      pickFolder: () => Promise.resolve(null),
      setVaultRoot: () => Promise.resolve(),
      ...bridge,
    },
  };
}

/** No signed-in account: the web reader answers null, so desktop checks rest on the bridge alone. */
const noAccount = async () => null;

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
    tree = create(createElement(Install097Gate, { webPort: noAccount, children: createElement(Child) }));
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

test("checking: while the check is pending the view says 'Checking…' and no children mount", async () => {
  stubBridge({ legacyDbPresent: () => new Promise(() => {}) });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(Install097Gate, { checkTimeoutMs: 60_000, webPort: noAccount, children: createElement(Child) }));
  });
  assert.ok(textOf(tree.root).includes("Checking…"));
  assert.equal(childCount(tree), 0);
  tree.unmount();
});

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
    pickFolder: () => Promise.resolve("/ws/moved"),
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
    pickFolder: () => Promise.resolve(null),
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
    pickFolder: () => Promise.reject(new Error("dialog broke")),
  });
  const tree = await mount();
  await press(buttonWith(tree, "Choose the folder you exported to"));
  assert.equal(childCount(tree), 0);
  assert.ok(textOf(tree.root).includes("PICK_FAILED"));
  buttonWith(tree, "Try again");
  tree.unmount();
});

test("picker: the shell has no pickFolder -> PICK_UNAVAILABLE, chooseVaultRoot never called", async () => {
  let switched = 0;
  stubBridge({
    vaultRoot: () => Promise.resolve({ path: "/ws/old" }),
    legacyDbPresent: () => Promise.resolve(true),
    migrationReportVerified: () => Promise.resolve(false),
    pickFolder: undefined,
    chooseVaultRoot: () => {
      switched += 1;
      return Promise.resolve({ path: "/ws/other" });
    },
  });
  const tree = await mount();
  await press(buttonWith(tree, "Choose the folder you exported to"));
  assert.equal(childCount(tree), 0);
  assert.ok(textOf(tree.root).includes("PICK_UNAVAILABLE"));
  assert.equal(switched, 0, "the gate never calls chooseVaultRoot, which switches the folder");
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

test("desktop, no local DB, signed-in old user with server rows and no export: web export notice, no children", async () => {
  stubBridge({ legacyDbPresent: () => Promise.resolve(false) });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      createElement(Install097Gate, {
        webPort: async () => ({ hasLegacyRows: async () => true, ownRunVerified: async () => false }),
        children: createElement(Child),
      }),
    );
    await new Promise((r) => setTimeout(r, 5));
  });
  assert.ok(textOf(tree.root).includes(INSTALL_097_WEB_NOTICE.title));
  assert.equal(childCount(tree), 0);
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
  // Unknown also offers the download and the picker, so a person can still move the export.
  const link = tree.root.findAll((n) => n.type === "a" && n.props.href === INSTALL_097_URL);
  assert.equal(link.length, 1, "unknown screen shows the 0.9.7 download link");
  buttonWith(tree, "Choose the folder you exported to");
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
    tree = create(createElement(Install097Gate, { checkTimeoutMs: 10, webPort: noAccount, children: createElement(Child) }));
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

test("picker: a dismissed dialog says 'No folder chosen' and changes nothing", async () => {
  let setCalls = 0;
  stubBridge({
    vaultRoot: () => Promise.resolve({ path: "/ws/old" }),
    legacyDbPresent: () => Promise.resolve(true),
    migrationReportVerified: () => Promise.resolve(false),
    pickFolder: () => Promise.resolve(null),
    setVaultRoot: () => {
      setCalls += 1;
      return Promise.resolve();
    },
  });
  const tree = await mount();
  await press(buttonWith(tree, "Choose the folder you exported to"));
  assert.ok(textOf(tree.root).includes("No folder chosen"));
  assert.equal(childCount(tree), 0);
  assert.equal(setCalls, 0);
  tree.unmount();
});

test("picker: a verified pick sets that folder as the vault root once, then the app mounts", async () => {
  const set: string[] = [];
  stubBridge({
    vaultRoot: () => Promise.resolve({ path: "/ws/old" }),
    legacyDbPresent: () => Promise.resolve(true),
    migrationReportVerified: (folder: string) => Promise.resolve(folder === "/ws/moved"),
    pickFolder: () => Promise.resolve("/ws/moved"),
    setVaultRoot: (folder: string) => {
      set.push(folder);
      return Promise.resolve();
    },
  });
  const tree = await mount();
  await press(buttonWith(tree, "Choose the folder you exported to"));
  assert.deepEqual(set, ["/ws/moved"], "the setter runs once, after verification, so the next launch passes");
  assert.equal(childCount(tree), 1);
  tree.unmount();
});

test("picker: an unverified pick never sets the vault root", async () => {
  let setCalls = 0;
  stubBridge({
    vaultRoot: () => Promise.resolve({ path: "/ws/old" }),
    legacyDbPresent: () => Promise.resolve(true),
    migrationReportVerified: () => Promise.resolve(false),
    pickFolder: () => Promise.resolve("/ws/wrong"),
    setVaultRoot: () => {
      setCalls += 1;
      return Promise.resolve();
    },
  });
  const tree = await mount();
  await press(buttonWith(tree, "Choose the folder you exported to"));
  assert.equal(setCalls, 0);
  assert.equal(childCount(tree), 0);
  tree.unmount();
});

test("picker: a shell without setVaultRoot cannot keep the verified folder -> SET_FOLDER_UNAVAILABLE", async () => {
  stubBridge({
    vaultRoot: () => Promise.resolve({ path: "/ws/old" }),
    legacyDbPresent: () => Promise.resolve(true),
    migrationReportVerified: (folder: string) => Promise.resolve(folder === "/ws/moved"),
    pickFolder: () => Promise.resolve("/ws/moved"),
    setVaultRoot: undefined,
  });
  const tree = await mount();
  await press(buttonWith(tree, "Choose the folder you exported to"));
  assert.equal(childCount(tree), 0);
  assert.ok(textOf(tree.root).includes("SET_FOLDER_UNAVAILABLE"));
  tree.unmount();
});

test("stale check: a first check that answers after its timeout and a retry cannot flip the newer check", async () => {
  const pending: Array<(v: boolean) => void> = [];
  stubBridge({
    legacyDbPresent: () => new Promise<boolean>((resolve) => pending.push(resolve)),
  });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(Install097Gate, { checkTimeoutMs: 10, webPort: noAccount, children: createElement(Child) }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  assert.ok(textOf(tree.root).includes("CHECK_TIMEOUT"));
  await press(buttonWith(tree, "Try again"));
  // The first check answers "not installed" late; it belongs to a request that is gone.
  await act(async () => {
    pending[0]?.(false);
    await new Promise((r) => setTimeout(r, 5));
  });
  assert.equal(childCount(tree), 0, "a stale answer must not open the app");
  // The newer check is the one that counts.
  await act(async () => {
    pending[1]?.(true);
    await new Promise((r) => setTimeout(r, 5));
  });
  assert.equal(childCount(tree), 0, "the newer check says the old database is present and unverified");
  tree.unmount();
});
