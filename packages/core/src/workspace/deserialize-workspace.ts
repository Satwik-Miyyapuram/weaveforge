/**
 * A folder of markdown → parsed entities, plus a diff against what is stored.
 *
 * Parsing is separated from applying on purpose: import is preview-first, and a
 * user has to be able to see "12 updated, 1 conflict" before anything is
 * written. Nothing here mutates or does I/O.
 *
 * The folder is untrusted input. It may have been shared by a collaborator or
 * written by something else on disk, so ids are matched conservatively (see
 * `diffWorkspace`) and paths are validated by the caller before reaching here.
 */

import { readFrontmatter, frontmatterList, frontmatterString } from "./frontmatter.js";
import type { WorkspaceEntityType } from "./folder-layout.js";
import { WORKSPACE_META_DIR, parseKindSuffix, stripKindSuffix } from "./folder-layout.js";

export interface ParsedEntity {
  /** Absent when the file carries no `weaveforge-id` — a hand-created file. */
  id?: string;
  type: WorkspaceEntityType;
  title: string;
  body: string;
  path: string;
  fields: Record<string, string | number | boolean | string[]>;
}

const KNOWN_TYPES = new Set<string>([
  "vault_page",
  "paper",
  "reading_list",
  "report_section",
  "experiment",
  "milestone",
  "log_entry",
]);

/** Infer the type from the top-level directory when frontmatter omits it. */
const DIR_TYPES: Record<string, WorkspaceEntityType> = {
  notes: "vault_page",
  papers: "paper",
  "reading-lists": "reading_list",
  report: "report_section",
  experiments: "experiment",
  plan: "milestone",
  logbook: "log_entry",
};

export function parseWorkspaceFile(path: string, content: string): ParsedEntity | null {
  if (path.startsWith(`${WORKSPACE_META_DIR}/`) || !path.endsWith(".md")) return null;
  if (path === "README.md") return null;

  const { frontmatter, body } = readFrontmatter(content);
  const declared = frontmatterString(frontmatter, "weaveforge-type");
  const fromDir = DIR_TYPES[path.split("/")[0] ?? ""];
  // Frontmatter, then the directory, then the filename suffix. The suffix is
  // last because a file dragged into another directory is what its directory
  // says it is, and it is present at all so a loose `ideas.note.md` still
  // imports as a note.
  const type =
    declared && KNOWN_TYPES.has(declared)
      ? (declared as WorkspaceEntityType)
      : (fromDir ?? parseKindSuffix(path));
  if (!type) return null;

  const fileName = path.split("/").pop() ?? path;
  const title =
    frontmatterString(frontmatter, "title") ??
    // Fall back to the filename minus any id suffix, so a hand-created
    // `notes/My idea.md` imports with a sensible title.
    stripKindSuffix(fileName).replace(/--[a-zA-Z0-9]{1,8}$/, "");

  const fields: ParsedEntity["fields"] = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (key === "weaveforge-id" || key === "weaveforge-type" || key === "title") continue;
    fields[key] = value;
  }

  return {
    id: frontmatterString(frontmatter, "weaveforge-id"),
    type,
    title: title.trim() || "Untitled",
    body: body.trimStart(),
    path,
    fields,
  };
}

/** Parse every markdown file in a folder. Non-entity files are skipped. */
export function parseWorkspaceFolder(files: Record<string, string>): ParsedEntity[] {
  const out: ParsedEntity[] = [];
  for (const [path, content] of Object.entries(files)) {
    const entity = parseWorkspaceFile(path, content);
    if (entity) out.push(entity);
  }
  return out;
}

export type ImportAction = "created" | "updated" | "unchanged" | "conflict";

export interface ImportDiffEntry {
  action: ImportAction;
  entity: ParsedEntity;
  /** Why an entry is a conflict, shown to the user before any write. */
  reason?: string;
}

export interface ImportDiff {
  entries: ImportDiffEntry[];
  counts: Record<ImportAction, number>;
}

export interface ExistingEntity {
  id: string;
  type: WorkspaceEntityType;
  title: string;
  body: string;
}

/**
 * Compare parsed files against what is stored.
 *
 * The id rules are the security-relevant part. An incoming id is honoured only
 * when an entity with that id already exists **and is the same type**. Anything
 * else becomes a creation with a fresh id rather than an overwrite, so a
 * crafted file cannot claim an existing note's id — or a different entity
 * type's — and replace it. Nothing is ever written blind: a mismatch is
 * surfaced as a conflict for the user to resolve.
 */
export function diffWorkspace(
  parsed: readonly ParsedEntity[],
  existing: readonly ExistingEntity[],
): ImportDiff {
  const byId = new Map(existing.map((entity) => [entity.id, entity]));
  const entries: ImportDiffEntry[] = [];

  for (const entity of parsed) {
    if (!entity.id) {
      entries.push({ action: "created", entity });
      continue;
    }

    const current = byId.get(entity.id);
    if (!current) {
      // An id from another workspace means nothing here; treat it as new.
      entries.push({ action: "created", entity });
      continue;
    }

    if (current.type !== entity.type) {
      entries.push({
        action: "conflict",
        entity,
        reason: `The id in ${entity.path} belongs to a ${current.type}, not a ${entity.type}.`,
      });
      continue;
    }

    const sameTitle = current.title.trim() === entity.title.trim();
    const sameBody = current.body.trim() === entity.body.trim();
    entries.push({ action: sameTitle && sameBody ? "unchanged" : "updated", entity });
  }

  const counts: Record<ImportAction, number> = {
    created: 0,
    updated: 0,
    unchanged: 0,
    conflict: 0,
  };
  for (const entry of entries) counts[entry.action] += 1;

  return { entries, counts };
}
