/**
 * Paper fields in the File repo's format (backend/providers/files/file-paper-field-repo.ts).
 *
 * - Definitions: `.weaveforge/settings.json` `paperFields`, keyed by field id.
 * - Values: each paper's `fields` frontmatter, keyed by field id. A value's id is `<paper id>:<field id>`.
 *
 * Server rows are camelCase (as listRows returns them). The server allows only text, number, select
 * and multi_select, so a relation field never reaches this mapping and needs no link lookup here.
 */
import type { Row } from "./ports";

export type FileFieldDef = { name: string; kind: string; options: string[]; sortOrder: number };
export type FileFieldValue = string | number | string[];

function asOption(o: unknown): string {
  if (typeof o !== "string") throw new Error("paper field option is not text");
  return o;
}

function asFieldValue(v: unknown): FileFieldValue {
  if (typeof v === "string" || typeof v === "number") return v;
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return [...v];
  throw new Error("paper field value is not text, a number or a text list");
}

/** Definition rows to the settings.json `paperFields` shape. Throws on a value that cannot be stored as-is. */
export function defsToSettings(rows: Row[]): Record<string, FileFieldDef> {
  const out: Record<string, FileFieldDef> = {};
  for (const r of rows) {
    const options = Array.isArray(r.options) ? r.options.map(asOption) : [];
    out[String(r.id)] = { name: String(r.name), kind: String(r.kind), options, sortOrder: Number(r.sortOrder) };
  }
  return out;
}

/** settings.json `paperFields` back to definition rows. */
export function defsFromSettings(settings: Record<string, FileFieldDef>): Row[] {
  return Object.entries(settings).map(([id, d]) => ({
    id,
    name: d.name,
    kind: d.kind,
    options: [...d.options],
    sortOrder: d.sortOrder,
  }));
}

/** Value rows to each paper's `fields` (paper id -> field id -> value). Throws on a value that is not text, a number or a text list. */
export function valuesToFields(rows: Row[]): Map<string, Record<string, FileFieldValue>> {
  const out = new Map<string, Record<string, FileFieldValue>>();
  for (const r of rows) {
    const paperId = String(r.paperId);
    const fields = out.get(paperId) ?? {};
    fields[String(r.fieldId)] = asFieldValue(r.value);
    out.set(paperId, fields);
  }
  return out;
}

/** Each paper's `fields` back to value rows, with the File repo's id `<paper id>:<field id>`. */
export function fieldsToValues(fields: Map<string, Record<string, FileFieldValue>>): Row[] {
  const out: Row[] = [];
  for (const [paperId, byField] of fields) {
    for (const [fieldId, value] of Object.entries(byField)) {
      out.push({ id: `${paperId}:${fieldId}`, paperId, fieldId, value });
    }
  }
  return out;
}
