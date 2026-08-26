/**
 * The pane layout: a binary tree of splits with tab bars at the leaves.
 *
 * Pure and side-effect free, because every hard case here is a state bug rather
 * than a rendering one — closing the last tab of a nested split, dropping a tab
 * whose entity was deleted while the layout sat in storage, moving the focused
 * tab out of the pane that had focus. Those are cheap to test as data and
 * miserable to test through a DOM, so the component below this file renders
 * what these functions return and decides nothing itself.
 *
 * A tab holds `{kind, id}`, never a path — see `workspace-tree.ts` for why.
 */

export interface TabRef {
  kind: string;
  id: string;
}

export interface PaneLeaf {
  type: "leaf";
  id: string;
  tabs: TabRef[];
  /** Index into `tabs`; clamped by every operation, never trusted on read. */
  activeIndex: number;
}

export interface PaneSplit {
  type: "split";
  direction: "row" | "column";
  /** First child's share of the axis, 0.1–0.9 so neither side can vanish. */
  ratio: number;
  children: [PaneNode, PaneNode];
}

export type PaneNode = PaneLeaf | PaneSplit;

export interface PaneLayout {
  root: PaneNode;
  focusedPaneId: string;
}

const MIN_RATIO = 0.1;
const MAX_RATIO = 0.9;

export function tabKey(tab: TabRef): string {
  return `${tab.kind}:${tab.id}`;
}

export function emptyLayout(paneId = "pane-1"): PaneLayout {
  return { root: { type: "leaf", id: paneId, tabs: [], activeIndex: 0 }, focusedPaneId: paneId };
}

export function leaves(node: PaneNode): PaneLeaf[] {
  return node.type === "leaf" ? [node] : [...leaves(node.children[0]), ...leaves(node.children[1])];
}

function clampIndex(leaf: PaneLeaf): PaneLeaf {
  const activeIndex = Math.min(Math.max(leaf.activeIndex, 0), Math.max(leaf.tabs.length - 1, 0));
  return activeIndex === leaf.activeIndex ? leaf : { ...leaf, activeIndex };
}

/** Rebuild the tree with one leaf replaced. `null` removes the leaf entirely. */
function replaceLeaf(node: PaneNode, paneId: string, next: (leaf: PaneLeaf) => PaneNode | null): PaneNode | null {
  if (node.type === "leaf") return node.id === paneId ? next(node) : node;
  const first = replaceLeaf(node.children[0], paneId, next);
  const second = replaceLeaf(node.children[1], paneId, next);
  // A split with one surviving child is not a split — it collapses, which is
  // what makes closing the last tab of a pane feel like closing the pane.
  if (!first) return second;
  if (!second) return first;
  if (first === node.children[0] && second === node.children[1]) return node;
  return { ...node, children: [first, second] };
}

function findLeaf(node: PaneNode, paneId: string): PaneLeaf | null {
  for (const leaf of leaves(node)) if (leaf.id === paneId) return leaf;
  return null;
}

/** Keep focus on a pane that still exists — the first one, if it does not. */
function settleFocus(root: PaneNode, preferred: string): PaneLayout {
  const focusedPaneId = findLeaf(root, preferred) ? preferred : leaves(root)[0]!.id;
  return { root, focusedPaneId };
}

/**
 * Show `tab` in a pane, focusing it if it is already open there.
 *
 * Reopening rather than duplicating is deliberate: two tabs on one document in
 * one pane is never what a click on the explorer meant, and it puts the same
 * document behind two tab headers that then disagree about which is dirty.
 */
export function openTab(layout: PaneLayout, tab: TabRef, paneId = layout.focusedPaneId): PaneLayout {
  const root = replaceLeaf(layout.root, paneId, (leaf) => {
    const existing = leaf.tabs.findIndex((open) => tabKey(open) === tabKey(tab));
    if (existing >= 0) return { ...leaf, activeIndex: existing };
    return { ...leaf, tabs: [...leaf.tabs, tab], activeIndex: leaf.tabs.length };
  });
  return settleFocus(root ?? layout.root, paneId);
}

export function activateTab(layout: PaneLayout, paneId: string, index: number): PaneLayout {
  const root = replaceLeaf(layout.root, paneId, (leaf) => clampIndex({ ...leaf, activeIndex: index }));
  return settleFocus(root ?? layout.root, paneId);
}

/**
 * Close one tab. The last tab of a pane closes the pane, unless it is the only
 * pane left — the workspace always has somewhere to open the next document.
 */
export function closeTab(layout: PaneLayout, paneId: string, index: number): PaneLayout {
  const onlyPane = leaves(layout.root).length === 1;
  const root = replaceLeaf(layout.root, paneId, (leaf) => {
    const tabs = leaf.tabs.filter((_, i) => i !== index);
    if (tabs.length === 0 && !onlyPane) return null;
    // Closing the active tab lands on the one that took its place, or on the
    // last tab when it was the rightmost — never on nothing.
    const activeIndex = leaf.activeIndex > index ? leaf.activeIndex - 1 : leaf.activeIndex;
    return clampIndex({ ...leaf, tabs, activeIndex });
  });
  return settleFocus(root ?? layout.root, paneId);
}

let paneCounter = 0;
function nextPaneId(): string {
  paneCounter += 1;
  return `pane-${Date.now().toString(36)}-${paneCounter}`;
}

/**
 * Split a pane in two, moving its active tab into the new half.
 *
 * Carrying the tab across is the point of the gesture: "split" almost always
 * means "show this next to that", and a split that opens empty makes the user
 * find the document again.
 */
export function splitPane(
  layout: PaneLayout,
  paneId: string,
  direction: PaneSplit["direction"],
  newPaneId = nextPaneId(),
): PaneLayout {
  const source = findLeaf(layout.root, paneId);
  if (!source) return layout;
  const carried = source.tabs[source.activeIndex];

  const root = replaceLeaf(layout.root, paneId, (leaf): PaneNode => {
    const created: PaneLeaf = {
      type: "leaf",
      id: newPaneId,
      tabs: carried ? [carried] : [],
      activeIndex: 0,
    };
    return { type: "split", direction, ratio: 0.5, children: [leaf, created] };
  });

  return { root: root ?? layout.root, focusedPaneId: newPaneId };
}

/** Move a tab between panes (or within one), preserving the document itself. */
export function moveTab(
  layout: PaneLayout,
  from: { paneId: string; index: number },
  toPaneId: string,
): PaneLayout {
  const source = findLeaf(layout.root, from.paneId);
  const tab = source?.tabs[from.index];
  if (!tab) return layout;
  if (from.paneId === toPaneId) return activateTab(layout, toPaneId, from.index);

  const opened = openTab(closeTab(layout, from.paneId, from.index), tab, toPaneId);
  return { ...opened, focusedPaneId: toPaneId };
}

export function setRatio(layout: PaneLayout, target: PaneSplit, ratio: number): PaneLayout {
  const clamped = Math.min(Math.max(ratio, MIN_RATIO), MAX_RATIO);
  const rewrite = (node: PaneNode): PaneNode => {
    if (node.type === "leaf") return node;
    if (node === target) return { ...node, ratio: clamped };
    return { ...node, children: [rewrite(node.children[0]), rewrite(node.children[1])] };
  };
  return { ...layout, root: rewrite(layout.root) };
}

export function focusPane(layout: PaneLayout, paneId: string): PaneLayout {
  return findLeaf(layout.root, paneId) ? { ...layout, focusedPaneId: paneId } : layout;
}

/** The tab a pane is showing, if any. */
export function activeTab(leaf: PaneLeaf): TabRef | undefined {
  return leaf.tabs[leaf.activeIndex];
}

/**
 * Drop tabs whose entity no longer exists, then collapse whatever that empties.
 *
 * A layout outlives the documents in it: something deleted on another device
 * comes back as a tab pointing at nothing, and rendering that is a broken pane
 * rather than an error worth showing.
 */
export function pruneLayout(layout: PaneLayout, exists: (tab: TabRef) => boolean): PaneLayout {
  const onlyPane = leaves(layout.root).length === 1;
  const rewrite = (node: PaneNode): PaneNode | null => {
    if (node.type === "leaf") {
      const tabs = node.tabs.filter(exists);
      if (tabs.length === 0 && !onlyPane) return null;
      return clampIndex({ ...node, tabs });
    }
    const first = rewrite(node.children[0]);
    const second = rewrite(node.children[1]);
    if (!first) return second;
    if (!second) return first;
    return { ...node, children: [first, second] };
  };
  const root = rewrite(layout.root) ?? emptyLayout().root;
  return settleFocus(root, layout.focusedPaneId);
}
