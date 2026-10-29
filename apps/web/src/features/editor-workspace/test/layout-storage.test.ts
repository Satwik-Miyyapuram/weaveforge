import { test } from "node:test";
import assert from "node:assert/strict";

import { LAYOUT_STORAGE_KEY, readLayout, writeLayout } from "../application/layout-storage";
import { emptyLayout, leaves, openTab, splitPane, type PaneSplit } from "../application/pane-tree";

function memoryStore(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

const SAVED = splitPane(openTab(emptyLayout(), { kind: "vault_page", id: "a" }), "pane-1", "column", "pane-2");

test("a first run is one empty pane", () => {
  assert.equal(readLayout(memoryStore()).root.type, "leaf");
  assert.equal(readLayout(undefined).root.type, "leaf");
});

test("a split, its direction, its ratio and its tabs all survive a restart", () => {
  const store = memoryStore();
  writeLayout(store, SAVED);
  const restored = readLayout(store);

  assert.equal(restored.root.type, "split");
  assert.equal((restored.root as PaneSplit).direction, "column");
  assert.equal((restored.root as PaneSplit).ratio, 0.5);
  assert.deepEqual(
    leaves(restored.root).map((leaf) => leaf.tabs.map((tab) => tab.id)),
    [["a"], ["a"]],
  );
  assert.equal(restored.focusedPaneId, "pane-2");
  assert.equal(LAYOUT_STORAGE_KEY, "weaveforge.editor.layout");
});

test("a record another version wrote falls back to an empty workspace, not a blank screen", () => {
  assert.equal(readLayout(memoryStore("not json")).root.type, "leaf");
  assert.equal(readLayout(memoryStore('{"root":{"type":"mystery"}}')).root.type, "leaf");
  assert.equal(readLayout(memoryStore("null")).root.type, "leaf");
});

test("half a split still restores the half that parsed", () => {
  const stored = JSON.stringify({
    root: {
      type: "split",
      direction: "row",
      ratio: 0.4,
      children: [{ type: "leaf", id: "pane-1", tabs: [{ kind: "paper", id: "p1" }], activeIndex: 0 }, null],
    },
  });

  const restored = readLayout(memoryStore(stored));
  assert.equal(restored.root.type, "leaf");
  assert.deepEqual(leaves(restored.root)[0]!.tabs, [{ kind: "paper", id: "p1" }]);
  assert.equal(restored.focusedPaneId, "pane-1");
});

test("junk inside a tab list is dropped and the active index follows it", () => {
  const stored = JSON.stringify({
    root: { type: "leaf", id: "pane-1", tabs: [{ kind: "vault_page" }, "nope", 3], activeIndex: 2 },
  });

  const restored = readLayout(memoryStore(stored));
  assert.deepEqual(leaves(restored.root)[0]!.tabs, []);
  assert.equal(leaves(restored.root)[0]!.activeIndex, 0);
});

test("a stored ratio outside the usable range is clamped on the way in", () => {
  const stored = JSON.stringify({
    root: {
      type: "split",
      direction: "row",
      ratio: 0.99,
      children: [
        { type: "leaf", id: "l", tabs: [], activeIndex: 0 },
        { type: "leaf", id: "r", tabs: [], activeIndex: 0 },
      ],
    },
  });

  assert.equal((readLayout(memoryStore(stored)).root as PaneSplit).ratio, 0.9);
});

test("storage that throws never costs the session its layout", () => {
  const hostile = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };

  assert.equal(readLayout(hostile).root.type, "leaf");
  assert.doesNotThrow(() => writeLayout(hostile, SAVED));
});

function keyedStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

test("each project keeps its own layout", () => {
  const store = keyedStore();
  writeLayout(store, SAVED, "p1");
  assert.equal(readLayout(store, "p1").root.type, "split");
  assert.equal(readLayout(store, "p2").root.type, "leaf");
  assert.ok(store.data.has(`${LAYOUT_STORAGE_KEY}.p1`));
  assert.ok(!store.data.has(LAYOUT_STORAGE_KEY));
});

test("the old global layout is adopted once, by the first project opened", () => {
  const store = keyedStore({ [LAYOUT_STORAGE_KEY]: JSON.stringify(SAVED) });
  assert.equal(readLayout(store, "p1").root.type, "split");
  assert.ok(store.data.has(`${LAYOUT_STORAGE_KEY}.p1`));
  assert.ok(!store.data.has(LAYOUT_STORAGE_KEY));
  // A second project does not inherit the first one's tabs.
  assert.equal(readLayout(store, "p2").root.type, "leaf");
});

test("a project's own record wins over a leftover global one", () => {
  const own = openTab(emptyLayout(), { kind: "vault_page", id: "own" });
  const store = keyedStore({
    [LAYOUT_STORAGE_KEY]: JSON.stringify(SAVED),
    [`${LAYOUT_STORAGE_KEY}.p1`]: JSON.stringify(own),
  });
  const restored = readLayout(store, "p1");
  assert.equal(restored.root.type, "leaf");
  assert.deepEqual(leaves(restored.root)[0]!.tabs.map((tab) => tab.id), ["own"]);
});

test("with no project chosen the layout uses the plain key", () => {
  const store = keyedStore();
  writeLayout(store, SAVED, null);
  assert.ok(store.data.has(LAYOUT_STORAGE_KEY));
  assert.equal(readLayout(store, null).root.type, "split");
});

test("a store without removeItem still adopts the legacy layout", () => {
  const data = new Map([[LAYOUT_STORAGE_KEY, JSON.stringify(SAVED)]]);
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  assert.equal(readLayout(store, "p1").root.type, "split");
  assert.ok(data.has(`${LAYOUT_STORAGE_KEY}.p1`));
});

test("a tab's mode survives a restart (28-01)", () => {
  const store = memoryStore();
  const layout = openTab(emptyLayout(), { kind: "vault_page", id: "a", mode: "ink" });
  writeLayout(store, layout);
  const [leaf] = leaves(readLayout(store).root);
  assert.deepEqual(leaf!.tabs, [{ kind: "vault_page", id: "a", mode: "ink" }]);
});

test("an old record without modes, or with an unknown one, restores tabs with no mode (28-01)", () => {
  const stored = JSON.stringify({
    root: {
      type: "leaf",
      id: "pane-1",
      tabs: [
        { kind: "vault_page", id: "old" },
        { kind: "vault_page", id: "odd", mode: "telepathy" },
      ],
      activeIndex: 0,
    },
  });
  const [leaf] = leaves(readLayout(memoryStore(stored)).root);
  assert.deepEqual(leaf!.tabs, [
    { kind: "vault_page", id: "old" },
    { kind: "vault_page", id: "odd" },
  ]);
});

test("a tab left in the old Read mode comes back unchosen, so it opens as it would today", () => {
  const stored = JSON.stringify({
    root: {
      type: "leaf",
      id: "pane-1",
      tabs: [{ kind: "vault_page", id: "n1", mode: "read" }, { kind: "vault_page", id: "n2", mode: "ink" }],
      activeIndex: 0,
    },
  });

  const restored = readLayout(memoryStore(stored));
  assert.deepEqual(leaves(restored.root)[0]!.tabs, [
    { kind: "vault_page", id: "n1" },
    { kind: "vault_page", id: "n2", mode: "ink" },
  ]);
});
