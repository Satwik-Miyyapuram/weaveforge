"use client";

import { useState } from "react";

import { openContextMenu } from "@/components/context-menu-store";
import { ToolButton } from "@/components/controls";
import type { MenuItem } from "@/components/menu";
import type { PaneLeaf } from "../application/pane-tree";
import { GROUP_COLORS, type TabGroup, type TabGroupCommand } from "../application/tab-groups";

/** What a group is called in menus: its name, or its place in the strip. */
export function groupLabel(leaf: PaneLeaf, group: TabGroup): string {
  return group.name || `Group ${(leaf.groups ?? []).indexOf(group) + 1}`;
}

/** The group items at the end of a tab's right-click menu. */
export function groupMenuItems(leaf: PaneLeaf, index: number, run: (c: TabGroupCommand) => void): MenuItem[] {
  const own = leaf.tabs[index]?.group;
  const others = (leaf.groups ?? []).filter((g) => g.id !== own);
  return [
    { id: "sep-group", label: "", kind: "separator" },
    { id: "group-new", label: "Add to new group", onSelect: () => run({ group: "new" }) },
    ...others.map(
      (g): MenuItem => ({
        id: `group-join-${g.id}`,
        label: `Add to ${groupLabel(leaf, g)}`,
        onSelect: () => run({ group: "join", id: g.id }),
      }),
    ),
    ...(own ? [{ id: "group-leave", label: "Remove from group", onSelect: () => run({ group: "leave" }) }] : []),
  ];
}

/** The chip's own right-click menu: rename, colour, ungroup. */
export function chipMenuItems(group: TabGroup, run: (c: TabGroupCommand) => void, rename: () => void): MenuItem[] {
  return [
    { id: "rename", label: "Rename", onSelect: rename },
    { id: "sep-color", label: "", kind: "separator" },
    ...GROUP_COLORS.map(
      (color): MenuItem => ({
        id: `color-${color}`,
        label: `Colour ${color}`,
        kind: "check",
        checked: group.color === color,
        onSelect: () => run({ group: "color", color }),
      }),
    ),
    { id: "sep-ungroup", label: "", kind: "separator" },
    { id: "dissolve", label: "Ungroup", onSelect: () => run({ group: "dissolve" }) },
  ];
}

/**
 * The coloured chip before a group's tabs. Click folds or unfolds the group,
 * double-click renames it, right-click offers rename, colour and ungroup.
 */
export function TabGroupChip({
  group,
  label,
  size,
  run,
}: {
  group: TabGroup;
  label: string;
  size: number;
  run: (c: TabGroupCommand) => void;
}) {
  const [editing, setEditing] = useState(false);
  const folded = group.collapsed === true;

  if (editing) {
    const finish = (name: string | null) => {
      setEditing(false);
      if (name !== null) run({ group: "rename", name });
    };
    return (
      <span className="pane-tab-group is-editing" data-tag-tone={group.color}>
        <input
          aria-label="Group name"
          defaultValue={group.name}
          autoFocus
          onBlur={(event) => finish(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") finish(event.currentTarget.value);
            if (event.key === "Escape") finish(null);
          }}
        />
      </span>
    );
  }

  return (
    <span className="pane-tab-group" data-tag-tone={group.color}>
      <ToolButton
        aria-expanded={!folded}
        label={label}
        tip={`${label}: ${folded ? "show" : "hide"} its tabs`}
        onClick={() => run({ group: "toggle" })}
        onDoubleClick={() => setEditing(true)}
        onContextMenu={(event) => openContextMenu(event, chipMenuItems(group, run, () => setEditing(true)))}
      >
        {group.name ? <span className="pane-tab-group-name">{group.name}</span> : null}
        {folded ? <span className="pane-tab-group-count">{size}</span> : null}
      </ToolButton>
    </span>
  );
}
