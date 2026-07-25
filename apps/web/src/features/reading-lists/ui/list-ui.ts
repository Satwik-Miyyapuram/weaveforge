import type { ReadingList } from "@thesis/core";

/** Preset list colors (matches graph/status palette). */
export const LIST_COLOR_PRESETS = [
  "#7c9885",
  "#5a7d8c",
  "#c98a6b",
  "#9a7bb0",
  "#c0573f",
  "#8a857c",
] as const;

export function listDisplayColor(list: ReadingList): string {
  if (list.color) return list.color;
  let h = 0;
  for (let i = 0; i < list.name.length; i++) h = (h * 31 + list.name.charCodeAt(i)) % 360;
  return `hsl(${h}, 48%, 58%)`;
}

export function collectListIds(tree: readonly { list: ReadingList; children: unknown[] }[]): string[] {
  const ids: string[] = [];
  const walk = (nodes: readonly { list: ReadingList; children: unknown[] }[]) => {
    for (const n of nodes) {
      ids.push(n.list.id);
      walk(n.children as typeof nodes);
    }
  };
  walk(tree);
  return ids;
}
