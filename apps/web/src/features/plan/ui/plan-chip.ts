import type { MilestoneDependency } from "@weaveforge/core";

import { isOfflineBuild } from "@/deployment/build-target";
import { readyCore } from "@/lib/rust-core";

/** What a dependency chip does when tapped. Rust `plan::chip::ChipTarget`. */
export type PlanChipTarget =
  | { kind: "link"; href: string; external: boolean }
  | { kind: "jump"; milestoneId: string }
  | { kind: "missing" }
  | { kind: "plain" };

/**
 * Papers and experiments open; milestones jump on the page; an external chip
 * links only when its label is a URL. A target that was deleted is "missing"
 * so the chip greys out instead of linking to nothing. The rule is Rust's
 * (`plan::chip::chip_target`); this only supplies the page's ids and the build flag.
 */
export function planChipTarget(
  dep: MilestoneDependency,
  known: ReadonlySet<string> | ReadonlyMap<string, string>,
  milestones: readonly { id: string; title: string }[],
): PlanChipTarget {
  return readyCore().planChipTarget(dep, [...known.keys()], milestones, isOfflineBuild());
}
