import type {
  PaperFieldDef,
  PaperFieldKind,
  PaperFieldValue,
  PaperFieldValueData,
} from "@weaveforge/core";

/**
 * How paper field rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface DefRow {
  id: string;
  name: string;
  kind: string;
  options: unknown;
  sort_order: number;
}

export interface ValueRow {
  id: string;
  paper_id: string;
  field_id: string;
  value: unknown;
}

export function toDef(row: DefRow): PaperFieldDef {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as PaperFieldKind,
    options: asStringArray(row.options),
    sortOrder: row.sort_order,
  };
}

export function toValue(row: ValueRow): PaperFieldValue {
  return {
    id: row.id,
    paperId: row.paper_id,
    fieldId: row.field_id,
    value: asValueData(row.value),
  };
}

export function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

export function asValueData(raw: unknown): PaperFieldValueData {
  if (typeof raw === "string" || typeof raw === "number") return raw;
  if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) return raw;
  throw new Error("Invalid paper field value payload.");
}
