/**
 * Tab groups: a named, coloured run of tabs in one pane's strip that can fold
 * behind a single chip. A group belongs to its pane; a tab carried to another
 * pane leaves it behind.
 *
 * Pure, like `pane-tree.ts`: each command maps a leaf to a new leaf.
 */
import type { PaneLeaf, TabRef } from "./pane-tree";

/** One of the six tag tones every theme defines (`data-tag-tone`). */
export type GroupColor = 1 | 2 | 3 | 4 | 5 | 6;
export const GROUP_COLORS: readonly GroupColor[] = [1, 2, 3, 4, 5, 6];

export interface TabGroup {
  id: string;
  /** May be empty: the chip then shows only its colour. */
  name: string;
  color: GroupColor;
  /** Only stored when true. */
  collapsed?: true;
}

export type TabGroupCommand =
  | { group: "new" }
  | { group: "join"; id: string }
  | { group: "leave" }
  | { group: "toggle" }
  | { group: "rename"; name: string }
  | { group: "color"; color: GroupColor }
  | { group: "dissolve" };

export function withoutGroup(tab: TabRef): TabRef {
  if (tab.group === undefined) return tab;
  const copy = { ...tab };
  delete copy.group;
  return copy;
}

/** The group a tab is in, if that group still exists in its pane. */
function groupOf(leaf: PaneLeaf, tab: TabRef | undefined): TabGroup | undefined {
  return tab?.group === undefined ? undefined : leaf.groups?.find((g) => g.id === tab.group);
}

/** Drop groups no tab is in, and group marks that name no group. */
export function cleanGroups(leaf: PaneLeaf): PaneLeaf {
  const groups = leaf.groups ?? [];
  const used = groups.filter((g) => leaf.tabs.some((t) => t.group === g.id));
  const tabs = leaf.tabs.map((t) => (used.some((g) => g.id === t.group) ? t : withoutGroup(t)));
  return { ...leaf, tabs, groups: used };
}

/** Move the tab at `from` to sit right after the last tab matching `after`. */
function moveAfter(leaf: PaneLeaf, from: number, tab: TabRef, after: (t: TabRef) => boolean): PaneLeaf {
  const active = leaf.tabs[leaf.activeIndex];
  const rest = leaf.tabs.filter((_, i) => i !== from);
  let at = from;
  rest.forEach((t, i) => {
    if (after(t)) at = i + 1;
  });
  const tabs = [...rest.slice(0, at), tab, ...rest.slice(at)];
  const activeIndex = leaf.activeIndex === from ? at : tabs.indexOf(active!);
  return { ...leaf, tabs, activeIndex: Math.max(activeIndex, 0) };
}

function nextId(groups: readonly TabGroup[]): string {
  const taken = groups.map((g) => Number(g.id.slice(1))).filter(Number.isFinite);
  return `g${Math.max(0, ...taken) + 1}`;
}

function editGroup(leaf: PaneLeaf, id: string, edit: (g: TabGroup) => TabGroup): PaneLeaf {
  return { ...leaf, groups: (leaf.groups ?? []).map((g) => (g.id === id ? edit(g) : g)) };
}

/** Apply a group command to the tab at `index`; unchanged when it does not apply. */
export function applyGroupCommand(leaf: PaneLeaf, index: number, command: TabGroupCommand): PaneLeaf {
  const tab = leaf.tabs[index];
  if (!tab) return leaf;
  const groups = leaf.groups ?? [];
  const current = groupOf(leaf, tab);

  if (command.group === "new") {
    const id = nextId(groups);
    const created: TabGroup = { id, name: "", color: GROUP_COLORS[groups.length % GROUP_COLORS.length]! };
    const tabs = leaf.tabs.map((t, i) => (i === index ? { ...t, group: id } : t));
    return cleanGroups({ ...leaf, tabs, groups: [...groups, created] });
  }
  if (command.group === "join") {
    if (!groups.some((g) => g.id === command.id) || current?.id === command.id) return leaf;
    return cleanGroups(moveAfter(leaf, index, { ...tab, group: command.id }, (t) => t.group === command.id));
  }
  if (!current) return leaf;

  switch (command.group) {
    case "leave":
      return cleanGroups(moveAfter(leaf, index, withoutGroup(tab), (t) => t.group === current.id));
    case "toggle":
      return editGroup(leaf, current.id, ({ collapsed, ...g }) => (collapsed ? g : { ...g, collapsed: true }));
    case "rename":
      return editGroup(leaf, current.id, (g) => ({ ...g, name: command.name.trim() }));
    case "color":
      return editGroup(leaf, current.id, (g) => ({ ...g, color: command.color }));
    case "dissolve":
      return cleanGroups({ ...leaf, tabs: leaf.tabs.map((t) => (t.group === current.id ? withoutGroup(t) : t)) });
  }
}

export interface TabRun {
  /** Set on the first tab of a group's run: draw the group's chip before it. */
  chip: TabGroup | null;
  /** In a folded group and not the open tab. */
  hidden: boolean;
  /** Tabs in the run, when `chip` is set; else 0. */
  size: number;
}

/** How to draw each tab of a strip: where chips go and which tabs fold away. */
export function groupRuns(leaf: PaneLeaf): TabRun[] {
  return leaf.tabs.map((tab, index) => {
    const group = groupOf(leaf, tab);
    if (!group) return { chip: null, hidden: false, size: 0 };
    const hidden = group.collapsed === true && index !== leaf.activeIndex;
    if (leaf.tabs[index - 1]?.group === group.id) return { chip: null, hidden, size: 0 };
    let size = 1;
    while (leaf.tabs[index + size]?.group === group.id) size += 1;
    return { chip: group, hidden, size };
  });
}
