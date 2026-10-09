import type { MilestoneDependency } from "@weaveforge/core";

import { experimentHref } from "@/features/experiments/application/experiment-href";

/** What a dependency chip does when tapped. */
export type PlanChipTarget =
  | { kind: "link"; href: string; external: boolean }
  | { kind: "jump"; milestoneId: string }
  | { kind: "missing" }
  | { kind: "plain" };

const URL_RE = /^https?:\/\/\S+$/i;

/**
 * Papers and experiments open; milestones jump on the page; an external chip
 * links only when its label is a URL. A target that was deleted is "missing"
 * so the chip greys out instead of linking to nothing.
 */
export function planChipTarget(
  dep: MilestoneDependency,
  known: { has(id: string): boolean },
  milestones: readonly { id: string; title: string }[],
): PlanChipTarget {
  if (dep.kind === "external") {
    const label = dep.label?.trim() ?? "";
    return URL_RE.test(label) ? { kind: "link", href: label, external: true } : { kind: "plain" };
  }
  if (dep.kind === "milestone") {
    const id = dep.refId || milestones.find((m) => m.title === dep.label)?.id;
    return id && known.has(id) ? { kind: "jump", milestoneId: id } : { kind: "missing" };
  }
  if (!dep.refId || !known.has(dep.refId)) return { kind: "missing" };
  return dep.kind === "paper"
    ? { kind: "link", href: `/papers?paper=${encodeURIComponent(dep.refId)}`, external: false }
    : { kind: "link", href: experimentHref(dep.refId), external: false };
}
