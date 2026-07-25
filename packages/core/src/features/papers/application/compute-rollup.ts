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

  const relationValue = values.find(
    (v) => v.paperId === paperId && v.fieldId === relationDef.id,
  )?.value;
  const relatedIds = Array.isArray(relationValue) ? relationValue : [];

  if (config.agg === "count") return relatedIds.length;

  if (!config.sourceFieldId) return null;
  const sourceDef = defs.find((d) => d.id === config.sourceFieldId);
  if (!sourceDef) return null;

  const relatedValues = relatedIds.flatMap((id) => {
    const row = values.find((v) => v.paperId === id && v.fieldId === sourceDef.id);
    return row ? [row.value] : [];
  });

  if (config.agg === "values") {
    const out: string[] = [];
    for (const value of relatedValues) {
      if (Array.isArray(value)) out.push(...value.map(String));
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
