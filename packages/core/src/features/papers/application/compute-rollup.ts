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
 * this module is called once per row *per rollup column* — a linear `find` per
 * lookup made a table of N rows against M values cost O(N × M) per column.
 * Building the map once per call makes each lookup constant time.
 *
 * First value wins, matching the `Array.prototype.find` this replaces: a
 * duplicate `(paperId, fieldId)` row behaves exactly as it did before.
 */
function indexValues(values: readonly PaperFieldValue[]): Map<string, PaperFieldValue> {
  const index = new Map<string, PaperFieldValue>();
  for (const value of values) {
    const key = valueKey(value.paperId, value.fieldId);
    if (!index.has(key)) index.set(key, value);
  }
  return index;
}

export function computeRollup(
  paperId: string,
  rollupDef: PaperFieldDef,
  defs: readonly PaperFieldDef[],
  values: readonly PaperFieldValue[],
): PaperFieldValueData | null {
  if (rollupDef.kind !== "rollup") return null;
  const config = parseRollupOptions(rollupDef.options);
  if (!config) return null;

  const relationDef = defs.find((d) => d.id === config.relationFieldId);
  if (!relationDef || relationDef.kind !== "relation") return null;

  const byKey = indexValues(values);
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
