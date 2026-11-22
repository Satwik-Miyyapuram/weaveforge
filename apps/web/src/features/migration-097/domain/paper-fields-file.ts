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
import type { MissingRow } from "./report";

/** Kinds the paper-fields writer owns (kind-writer-paper-fields.ts). Neither needs a wf-wasm codec. */
export const PAPER_FIELD_KINDS = ["paperFields", "paperFieldValues"] as const;

const DEF_FIELDS = ["id", "projectId", "name", "kind", "options", "sortOrder"] as const;

/** A server project id as the key the File format uses: a null, undefined or empty id is the workspace root (""). */
export function projectKey(projectId: unknown): string {
  return projectId === null || projectId === undefined || projectId === "" ? "" : String(projectId);
}

function groupByProject(rows: Row[]): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const r of rows) {
    const projectId = projectKey(r.projectId);
    out.set(projectId, [...(out.get(projectId) ?? []), r]);
  }
  return out;
}

/** Stable text of one project's defs, over the fields the File format keeps. */
function defsKey(rows: Row[]): string {
  const picked: Record<string, unknown>[] = rows.map((r) => ({
    ...Object.fromEntries(DEF_FIELDS.map((k) => [k, r[k]])),
    projectId: projectKey(r.projectId),
  }));
  picked.sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  return JSON.stringify(picked);
}

/**
 * Compares the defs per project. A project with defs in the source but none read back is "absent";
 * any other difference (a changed def, or defs read back for a project the source lacks) is "differ".
 * Each finding names the project id, so the report says which project did not survive.
 */
export function projectDefsMismatches(want: Row[], got: Row[]): MissingRow[] {
  const wantBy = groupByProject(want);
  const gotBy = groupByProject(got);
  const out: MissingRow[] = [];
  for (const projectId of new Set([...wantBy.keys(), ...gotBy.keys()])) {
    const w = wantBy.get(projectId) ?? [];
    const g = gotBy.get(projectId) ?? [];
    if (w.length > 0 && g.length === 0) out.push({ kind: "paperFields", id: projectId, reason: "project defs absent" });
    else if (defsKey(w) !== defsKey(g)) out.push({ kind: "paperFields", id: projectId, reason: "project defs differ" });
  }
  return out;
}

/** One def as the File repo stores it. projectId is the project folder ("" = workspace root). */
export type FileFieldDef = { projectId: string; name: string; kind: string; options: string[]; sortOrder: number };
export type FileFieldValue = string | number | string[];

/**
 * Whether two field values hold the same data as the file and the DB see them. Relations and multi-selects are
 * sets, so their order does not count; scalars must match exactly. A value is never an object (FileFieldValue).
 */
export function sameFieldValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => (Array.isArray(v) ? v.map(String).sort() : v);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

function asOption(o: unknown): string {
  if (typeof o !== "string") throw new Error("paper field option is not text");
  return o;
}

function asFieldValue(v: unknown): FileFieldValue {
  if (typeof v === "string" || typeof v === "number") return v;
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return [...v];
  throw new Error("paper field value is not text, a number or a text list");
}

/**
 * Definition rows to the settings.json `paperFields` shape. `folders` maps each server project id to its
 * project folder ("" = workspace root), named as the project export names folders. A def whose project has
 * no folder throws rather than landing in the workspace root. Throws on a value that cannot be stored as-is.
 */
export function defsToSettings(rows: Row[], folders: ReadonlyMap<string, string>): Record<string, FileFieldDef> {
  const out: Record<string, FileFieldDef> = {};
  for (const r of rows) {
    const projectId = projectKey(r.projectId);
    const folder = projectId === "" ? "" : folders.get(projectId);
    if (folder === undefined) throw new Error(`paper field ${String(r.id)}: project ${projectId} has no folder`);
    const options = Array.isArray(r.options) ? r.options.map(asOption) : [];
    out[String(r.id)] = { projectId: folder, name: String(r.name), kind: String(r.kind), options, sortOrder: Number(r.sortOrder) };
  }
  return out;
}

/** settings.json `paperFields` back to definition rows. `serverIds` maps each folder back to its server project id. */
export function defsFromSettings(settings: Record<string, FileFieldDef>, serverIds: ReadonlyMap<string, string>): Row[] {
  return Object.entries(settings).map(([id, d]) => ({
    id,
    projectId: serverIds.get(d.projectId) ?? d.projectId,
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
