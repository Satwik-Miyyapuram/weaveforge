/**
 * Rollup columns (Rust `papers::compute_rollup::compute_rollup_for_papers`).
 * Re-exported from index.ts. One call per rollup column: the values cross into wasm once
 * for all listed papers, so a table does not serialize them per cell.
 */
import { computeRollupsForPapers as rawComputeRollupsForPapers } from "../pkg/wf_wasm.js";
import type { PaperFieldValueData, RollupFieldDef, RollupValue } from "./bindings.js";

export type { RollupFieldDef, RollupValue } from "./bindings.js";

/** Options are optional here; a def without them reads as having none. */
function withOptions(
  def: Omit<RollupFieldDef, "options"> & { options?: readonly string[] },
): RollupFieldDef {
  return { ...def, options: [...(def.options ?? [])] };
}

/**
 * Each listed paper's value for `rollup`, in `paperIds` order. `null` where the rollup has
 * no value for that paper.
 */
export function computeRollupsForPapers(
  paperIds: readonly string[],
  rollup: Omit<RollupFieldDef, "options"> & { options?: readonly string[] },
  defs: readonly (Omit<RollupFieldDef, "options"> & { options?: readonly string[] })[],
  values: readonly RollupValue[],
): (PaperFieldValueData | null)[] {
  return rawComputeRollupsForPapers(
    paperIds,
    withOptions(rollup),
    defs.map(withOptions),
    values,
  ) as (PaperFieldValueData | null)[];
}
