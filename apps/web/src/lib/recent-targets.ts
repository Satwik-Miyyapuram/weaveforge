import { readyCore } from "@/lib/rust-core";

export type RecentTargetKind = "paper" | "note" | "section";

export interface RecentTarget {
  kind: RecentTargetKind;
  id: string;
  title: string;
  href: string;
  visitedAt: string;
}

const PREFIX = "thesis.jump-recents";
const LIMIT = 15;

function key(projectId: string) {
  return `${PREFIX}.${projectId}`;
}

/** Storage is user-editable: keep only entries the jump list can use. */
function isRecentTarget(value: unknown): value is RecentTarget {
  return readyCore().isRecentTarget(value);
}

export function readRecentTargets(projectId: string | null): RecentTarget[] {
  if (!projectId || typeof localStorage === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(key(projectId)) ?? "[]");
    return Array.isArray(value) ? value.filter(isRecentTarget).slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberRecentTarget(
  projectId: string | null,
  target: Omit<RecentTarget, "visitedAt">,
): RecentTarget[] {
  if (!projectId || typeof localStorage === "undefined") return [];
  const next: RecentTarget[] = [
    { ...target, visitedAt: new Date().toISOString() },
    ...readRecentTargets(projectId).filter(
      (item) => !(item.kind === target.kind && item.id === target.id),
    ),
  ].slice(0, LIMIT);
  try {
    localStorage.setItem(key(projectId), JSON.stringify(next));
  } catch {
    // Storage is shared, finite, and sometimes switched off: Safari's private
    // mode throws, and so does a full origin. The read above is already treated
    // as fallible; recording a recent visit is not worth aborting the
    // navigation this is called from — three of its four callers do it inside
    // an effect, where a throw is a blank screen rather than a lost click.
  }
  return next;
}

/**
 * `items` with the recently opened ones moved to the front, in visit order and
 * flagged `recent`. A recent target that no longer matches an item is skipped.
 */
export function pinRecentTargets<T extends { kind: string; id: string }>(
  items: readonly T[],
  recents: readonly { kind: string; id: string }[],
): (T & { recent?: true })[] {
  // Malformed entries are skipped here, as the TS version did, so the wasm call
  // only ever sees well-formed keys.
  return readyCore().pinRecentTargets(
    items.filter((item) => isRecentTarget(item)),
    recents.filter((item) => isRecentTarget(item)),
  );
}
