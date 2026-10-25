import type { ReadingList } from "@weaveforge/core";

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

/** `ids` with `dragId` moved into `targetId`'s place, or null when nothing moves. */
export function reorderedIds(ids: readonly string[], dragId: string, targetId: string): string[] | null {
  if (dragId === targetId) return null;
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return null;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, dragId);
  return next;
}

/** `ids` with `id` moved one step up (-1) or down (1), or null at either end. */
export function movedIds(ids: readonly string[], id: string, step: -1 | 1): string[] | null {
  const target = ids[ids.indexOf(id) + step];
  return ids.includes(id) && target !== undefined ? reorderedIds(ids, id, target) : null;
}
