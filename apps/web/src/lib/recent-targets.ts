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

export function readRecentTargets(projectId: string | null): RecentTarget[] {
  if (!projectId || typeof localStorage === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(key(projectId)) ?? "[]");
    return Array.isArray(value) ? value.slice(0, LIMIT) : [];
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
  localStorage.setItem(key(projectId), JSON.stringify(next));
  return next;
}
