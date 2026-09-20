/**
 * Compute a rollup value from related papers' field values.
 * Pure — no I/O. Callers supply the already-loaded project values.
 */

import type {
  PaperFieldDef,
  PaperFieldValue,
  PaperFieldValueData,
} from "../domain/paper-field.js";
import { parseRollupOptions } from "../domain/paper-field.js";

/**
 * Key for the `(paperId, fieldId)` pair.
 *
 * NUL as the separator, because both halves are arbitrary user text and any
 * printable delimiter can occur inside one of them — the same reason the metrics
 * ingest route keys its series this way.
 */
function valueKey(paperId: string, fieldId: string): string {
  return `${paperId}\u0000${fieldId}`;
}

/**
 * Index every value by `(paperId, fieldId)`.
 *
 * `values` is the whole project's field values, loaded once by the caller, and
 * this is the expensive part of a rollup: a linear `find` per lookup made a
 * table of N rows against M values cost O(N × M) per column.
 *
 * Exported, and separate from the computation, because the index is a pure
 * function of `values` — which does not change between the cells of one render.
 * Building it inside `computeRollup` fixed the lookup and left the same problem
 * one level up: the module's own comment says it is called once per row *per
 * rollup column*, so a 500-paper table with three rollup columns built the same
 * index 1 500 times. Callers rendering a table build it once and pass it to
 * {@link computeRollupFromIndex}.
 *
 * First value wins, matching the `Array.prototype.find` this replaces: a
 * duplicate `(paperId, fieldId)` row behaves exactly as it did before.
 */
export function createValueIndex(
  values: readonly PaperFieldValue[],
): Map<string, PaperFieldValue> {
  const index = new Map<string, PaperFieldValue>();
  for (const value of values) {
    const key = valueKey(value.paperId, value.fieldId);
    if (!index.has(key)) index.set(key, value);
  }
  return index;
}

/**
 * A rollup computed from a value index the caller built once.
 *
 * This is what a table calls. {@link computeRollup} is the same computation for
 * a caller that has one cell to fill and would rather not think about indexes.
 */
export function computeRollupFromIndex(
  paperId: string,
  rollupDef: PaperFieldDef,
  defs: readonly PaperFieldDef[],
  byKey: Map<string, PaperFieldValue>,
): PaperFieldValueData | null {
  if (rollupDef.kind !== "rollup") return null;
  const config = parseRollupOptions(rollupDef.options);
  if (!config) return null;

  const relationDef = defs.find((d) => d.id === config.relationFieldId);
  if (!relationDef || relationDef.kind !== "relation") return null;

  const relationValue = byKey.get(valueKey(paperId, relationDef.id))?.value;
  const relatedIds = Array.isArray(relationValue) ? relationValue : [];

  if (config.agg === "count") return relatedIds.length;

  if (!config.sourceFieldId) return null;
  const sourceDef = defs.find((d) => d.id === config.sourceFieldId);
  if (!sourceDef) return null;

  const relatedValues = relatedIds.flatMap((id) => {
    const row = byKey.get(valueKey(id, sourceDef.id));
    return row ? [row.value] : [];
  });

  if (config.agg === "values") {
    const out: string[] = [];
    for (const value of relatedValues) {
      // Appended one at a time rather than `out.push(...value)`: a spread is
      // one call argument per element, and a relation with six figures of ids
      // would overflow the stack instead of producing the list.
      if (Array.isArray(value)) for (const item of value) out.push(String(item));
      else if (value != null) out.push(String(value));
    }
    return out;
  }

  const numbers = relatedValues
    .map((value) => (typeof value === "number" ? value : Number(value)))
    .filter((n) => Number.isFinite(n));
  if (numbers.length === 0) return null;
  if (config.agg === "sum") return numbers.reduce((a, b) => a + b, 0);
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

/**
 * One rollup, for a caller that has the project's values in hand.
 *
 * Builds the index per call, so it costs O(values) each time: use
 * {@link computeRollupFromIndex} when filling more than one cell.
 */
export function computeRollup(
  paperId: string,
  rollupDef: PaperFieldDef,
  defs: readonly PaperFieldDef[],
  values: readonly PaperFieldValue[],
): PaperFieldValueData | null {
  return computeRollupFromIndex(paperId, rollupDef, defs, createValueIndex(values));
}
