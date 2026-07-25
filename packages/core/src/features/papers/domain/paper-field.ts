import type { Identifiable } from "../../../shared/repository.js";

/** Supported custom field kinds on papers. */
export const PAPER_FIELD_KINDS = [
  "text",
  "number",
  "select",
  "multi_select",
  "relation",
  "rollup",
] as const;
export type PaperFieldKind = (typeof PAPER_FIELD_KINDS)[number];

export type PaperFieldRollupAgg = "count" | "values" | "sum" | "avg";

/** Rollup config encoded in `options` for kind=rollup. */
export interface PaperFieldRollupConfig {
  relationFieldId: string;
  agg: PaperFieldRollupAgg;
  /** Required for values/sum/avg — the related paper's field to aggregate. */
  sourceFieldId?: string;
}

/** Project-scoped definition of a custom field shown on every paper. */
export interface PaperFieldDef extends Identifiable {
  id: string;
  name: string;
  kind: PaperFieldKind;
  /**
   * Option labels for select / multi_select.
   * For rollup: encoded config tokens (`rel:…`, `agg:…`, optional `src:…`).
   * Empty for text / number / relation.
   */
  options: string[];
  sortOrder: number;
}

export interface NewPaperFieldDefInput {
  name: string;
  kind: PaperFieldKind;
  options?: string[];
  rollup?: PaperFieldRollupConfig;
}

/**
 * Stored value payload. Shape depends on the field kind:
 * - text / select → string
 * - number → number
 * - multi_select / relation → string[] (option labels or paper ids)
 * - rollup → not stored (computed)
 */
export type PaperFieldValueData = string | number | string[];

/** One paper's value for one field definition. */
export interface PaperFieldValue extends Identifiable {
  id: string;
  paperId: string;
  fieldId: string;
  value: PaperFieldValueData;
}

export interface SetPaperFieldValueInput {
  paperId: string;
  fieldId: string;
  value: PaperFieldValueData;
}

export class PaperFieldValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaperFieldValidationError";
  }
}

export function isPaperFieldKind(value: string): value is PaperFieldKind {
  return (PAPER_FIELD_KINDS as readonly string[]).includes(value);
}

export function encodeRollupOptions(config: PaperFieldRollupConfig): string[] {
  const out = [`rel:${config.relationFieldId}`, `agg:${config.agg}`];
  if (config.sourceFieldId) out.push(`src:${config.sourceFieldId}`);
  return out;
}

export function parseRollupOptions(options: readonly string[]): PaperFieldRollupConfig | null {
  let relationFieldId = "";
  let agg: PaperFieldRollupAgg | "" = "";
  let sourceFieldId: string | undefined;
  for (const token of options) {
    if (token.startsWith("rel:")) relationFieldId = token.slice(4);
    else if (token.startsWith("agg:")) agg = token.slice(4) as PaperFieldRollupAgg;
    else if (token.startsWith("src:")) sourceFieldId = token.slice(4);
  }
  if (!relationFieldId) return null;
  if (agg !== "count" && agg !== "values" && agg !== "sum" && agg !== "avg") return null;
  return { relationFieldId, agg, sourceFieldId };
}
