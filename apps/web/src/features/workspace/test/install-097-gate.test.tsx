/**
 * The install gate: with an old database present and no verified 0.9.7 report it blocks the app
 * and renders none of the children; otherwise the children mount. The gate only reads the bridge.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import * as React from "react";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import "@/lib/test/react-harness";
Object.assign(globalThis, { React });
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

/** No browser reader: the web port answers null, so browser checks open and desktop rests on the bridge. */
const noBrowserReader = async () => null;

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
    tree = create(createElement(Install097Gate, { webPort: noBrowserReader, children: createElement(Child) }));
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
    tree = create(createElement(Install097Gate, { checkTimeoutMs: 60_000, webPort: noBrowserReader, children: createElement(Child) }));
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

test("desktop is per device: no local DB opens and the browser reader is never asked", async () => {
  stubBridge({ legacyDbPresent: () => Promise.resolve(false) });
  let asked = 0;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      createElement(Install097Gate, {
        webPort: async () => {
          asked += 1;
          return { oldDataHere: async () => true, exportedHere: async () => false };
        },
        children: createElement(Child),
      }),
    );
    await new Promise((r) => setTimeout(r, 5));
  });
  assert.ok(!textOf(tree.root).includes(INSTALL_097_WEB_NOTICE.title));
  assert.equal(childCount(tree), 1);
  assert.equal(asked, 0);
  tree.unmount();
});

test("passes: browser (no desktop bridge) -> children mount at once", async () => {
  g.window = undefined;
  const tree = await mount();
  assert.equal(childCount(tree), 1);
  tree.unmount();
});

test("fail open: legacy check rejects -> app opens, no error screen", async () => {
  stubBridge({ legacyDbPresent: () => Promise.reject(new Error("ipc down")) });
  const tree = await mount();
  assert.equal(childCount(tree), 1);
  assert.ok(!textOf(tree.root).includes("LEGACY_CHECK_FAILED"));
  tree.unmount();
});

test("fail open: desktop shell without legacyDbPresent -> app opens", async () => {
  stubBridge({});
  const tree = await mount();
  assert.equal(childCount(tree), 1);
  assert.ok(!textOf(tree.root).includes("LEGACY_CHECK_UNAVAILABLE"));
  tree.unmount();
});

test("fail open: report check throws while old DB present -> app opens", async () => {
  stubBridge({
    vaultRoot: () => Promise.resolve({ path: "/ws/old" }),
    legacyDbPresent: () => Promise.resolve(true),
    migrationReportVerified: () => Promise.reject(new Error("bridge down")),
  });
  const tree = await mount();
  assert.equal(childCount(tree), 1);
  assert.ok(!textOf(tree.root).includes("REPORT_CHECK_FAILED"));
  tree.unmount();
});

test("fail open: report method absent while old DB present -> app opens", async () => {
  stubBridge({
    vaultRoot: () => Promise.resolve({ path: "/ws/old" }),
    legacyDbPresent: () => Promise.resolve(true),
  });
  const tree = await mount();
  assert.equal(childCount(tree), 1);
  assert.ok(!textOf(tree.root).includes("REPORT_CHECK_UNAVAILABLE"));
  tree.unmount();
});

test("check never answers -> the timeout opens the gate (no CHECK_TIMEOUT block)", async () => {
  stubBridge({ legacyDbPresent: () => new Promise(() => {}) });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(Install097Gate, { checkTimeoutMs: 10, webPort: noBrowserReader, children: createElement(Child) }));
  });
  // The timeout starts when the effect flushes at the end of act, so wait in a second act.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  assert.equal(childCount(tree), 1);
  assert.ok(!textOf(tree.root).includes("CHECK_TIMEOUT"));
  tree.unmount();
});

test("a rejected check opens at once; no blocked screen or Try again is shown", async () => {
  stubBridge({
    legacyDbPresent: () => Promise.reject(new Error("ipc down")),
  });
  const tree = await mount();
  assert.equal(childCount(tree), 1);
  assert.ok(!textOf(tree.root).includes("Try again"));
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

test("picker: a verified pick opens even when the shell cannot keep the folder (fail open)", async () => {
  stubBridge({
    vaultRoot: () => Promise.resolve({ path: "/ws/old" }),
    legacyDbPresent: () => Promise.resolve(true),
    migrationReportVerified: (folder: string) => Promise.resolve(folder === "/ws/moved"),
    pickFolder: () => Promise.resolve("/ws/moved"),
    setVaultRoot: undefined,
  });
  const tree = await mount();
  await press(buttonWith(tree, "Choose the folder you exported to"));
  assert.equal(childCount(tree), 1);
  assert.ok(!textOf(tree.root).includes("SET_FOLDER_UNAVAILABLE"));
  tree.unmount();
});

test("picker: a pick whose report check throws opens (fail open) but never sets the vault root", async () => {
  let setCalls = 0;
  stubBridge({
    vaultRoot: () => Promise.resolve({ path: "/ws/old" }),
    legacyDbPresent: () => Promise.resolve(true),
    migrationReportVerified: (folder: string) => (folder === "/ws/old" ? Promise.resolve(false) : Promise.reject(new Error("boom"))),
    pickFolder: () => Promise.resolve("/ws/moved"),
    setVaultRoot: () => {
      setCalls += 1;
      return Promise.resolve();
    },
  });
  const tree = await mount();
  await press(buttonWith(tree, "Choose the folder you exported to"));
  assert.equal(childCount(tree), 1, "a check that cannot answer still opens");
  assert.equal(setCalls, 0, "only a verified folder is kept as the workspace folder");
  tree.unmount();
});

test("picker: a pick whose report check answers a non-boolean opens but never sets the vault root", async () => {
  let setCalls = 0;
  stubBridge({
    vaultRoot: () => Promise.resolve({ path: "/ws/old" }),
    legacyDbPresent: () => Promise.resolve(true),
    migrationReportVerified: (folder: string) => Promise.resolve(folder === "/ws/old" ? false : "yes"),
    pickFolder: () => Promise.resolve("/ws/moved"),
    setVaultRoot: () => {
      setCalls += 1;
      return Promise.resolve();
    },
  });
  const tree = await mount();
  await press(buttonWith(tree, "Choose the folder you exported to"));
  assert.equal(childCount(tree), 1);
  assert.equal(setCalls, 0);
  tree.unmount();
});

test("timed-out check opens; a late old-database answer cannot close the open gate", async () => {
  const pending: Array<(v: boolean) => void> = [];
  stubBridge({
    legacyDbPresent: () => new Promise<boolean>((resolve) => pending.push(resolve)),
  });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(Install097Gate, { checkTimeoutMs: 10, webPort: noBrowserReader, children: createElement(Child) }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  assert.equal(childCount(tree), 1, "the timeout opens the app");
  // The late answer belongs to a check that already settled; it must be ignored.
  await act(async () => {
    pending[0]?.(true);
    await new Promise((r) => setTimeout(r, 5));
  });
  assert.equal(childCount(tree), 1, "a late answer must not re-gate the app");
  tree.unmount();
});
