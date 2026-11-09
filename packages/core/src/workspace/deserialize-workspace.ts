/**
 * Shapes of a folder import: parsed entities and the diff against what is stored.
 * Parsing and the diff (`parseWorkspaceFolder`, `diffWorkspace`) are Rust, reached
 * through `rust()`. The folder is untrusted input: ids are matched conservatively
 * there, and paths are validated by the caller before reaching here.
 */

import { frontmatterString } from "./frontmatter.js";
import type { WorkspaceEntityType } from "./folder-layout.js";
import { ENTITY_DIRS, WORKSPACE_META_DIR, parseKindSuffix, stripKindSuffix } from "./folder-layout.js";
import { INK_NOTE_TYPE, readInkNoteMeta, writeInkNoteBody } from "../ink/ink-note.js";
import { rust } from "../shared/rust.js";

export interface ParsedEntity {
  /** Absent when the file carries no `weaveforge-id` — a hand-created file. */
  id?: string;
  type: WorkspaceEntityType;
  title: string;
  body: string;
  path: string;
  fields: Record<string, string | number | boolean | string[]>;
}

// Every type has a directory, so the directory table lists them all. An ink
// note declares its type in frontmatter as well as in its `.ink.md` suffix;
// without the declaration the directory would win and a note with strokes would
// import as a plain note — see the precedence note below.
const KNOWN_TYPES = new Set<string>(Object.keys(ENTITY_DIRS));

/**
 * Infer the type from the directory when frontmatter omits it.
 *
 * The first segment that names an entity type wins, so both layouts read:
 * `notes/idea.md` at the root, and `msc-thesis--8d7317/notes/idea.md` once the
 * folder is scoped to a project. A hand-written file inside a project folder is
 * the case this is for: it carries no `weaveforge-type` and no kind suffix, so
 * the directory is the only thing that can say what it is.
 */
const DIR_TYPES: Record<string, WorkspaceEntityType> = Object.fromEntries(
  (Object.entries(ENTITY_DIRS) as [WorkspaceEntityType, string][])
    // `notes/` holds ink notes too, but a file there without a declaration is a note.
    .filter(([type]) => type !== INK_NOTE_TYPE)
    .map(([type, dir]) => [dir, type]),
);

export function parseWorkspaceFile(path: string, content: string): ParsedEntity | null {
  const segments = path.split("/");
  // `.weaveforge/` at the root, or beside a project's files: bookkeeping either
  // way, and never an entity.
  if (segments.includes(WORKSPACE_META_DIR) || !path.endsWith(".md")) return null;
  if (segments[segments.length - 1] === "README.md") return null;

  const { frontmatter, body } = rust().readFrontmatter(content);
  const declared = frontmatterString(frontmatter, "weaveforge-type");
  const fromDir = DIR_TYPES[segments[0] ?? ""] ?? DIR_TYPES[segments[1] ?? ""];
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

  // An ink note is stored as a note whose body starts with the ink header (see
  // `ink-note.ts`), so the folder's `ink_page` comes back as a `vault_page` with
  // its frontmatter ink keys folded into that line. The importer then treats it
  // as the note it is, and the strokes stay in `.ink/<id>/` where they were.
  if (type === INK_NOTE_TYPE) {
    return {
      id: frontmatterString(frontmatter, "weaveforge-id"),
      type: "vault_page",
      title: title.trim() || "Untitled",
      body: writeInkNoteBody(readInkNoteMeta(frontmatter), body.trimStart()),
      path,
      fields,
    };
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

/**
 * What an import would do to one thing.
 *
 * `removed` is only ever produced by the JSON data files: a markdown entity has
 * no row to delete — a file that goes is simply no longer mirrored — whereas a
 * relation, a tag or a membership that the folder stopped listing is a row the
 * reader deleted, and saying so is the honest report of it.
 */
export type ImportAction = "created" | "updated" | "unchanged" | "conflict" | "removed";

/**
 * Why an entry conflicts, which decides what may be done about it.
 *
 * `both-changed` can be settled any way the user likes -- the two copies are
 * both notes and either is a legitimate answer. `type-mismatch` cannot: the id
 * in the file belongs to a different kind of entity, so there is nothing to
 * update, and importing the file as a new note is the only safe outcome.
 */
export type ConflictKind = "both-changed" | "type-mismatch" | "markers";

export interface ImportDiffEntry {
  action: ImportAction;
  entity: ParsedEntity;
  /** Why an entry is a conflict, shown to the user before any write. */
  reason?: string;
  kind?: ConflictKind;
  /**
   * The fields a per-field merge could not settle, when one was attempted.
   *
   * Present only on a `both-changed` conflict that survived the merge, and it
   * names what is actually in dispute -- `body`, or a frontmatter key -- so the
   * user is asked about the disagreement rather than about the file.
   */
  conflictFields?: readonly string[];
  /**
   * Everything the resolver needs to offer a choice, when one was prepared.
   *
   * Filled by the folder import, not here: this module compares copies and has
   * no merge of its own. Present only on a `both-changed` conflict that the
   * per-field merge could not settle.
   */
  merge?: ImportMergeDetail;
}

/**
 * One key both sides moved, with all three sides so a person can pick.
 *
 * `ours` is the workspace's value and `theirs` the folder's, matching the
 * direction the rest of the import defaults in: an unsettled difference keeps
 * what is already in the app.
 */
export interface MergeFieldDispute {
  field: string;
  base: unknown;
  ours: unknown;
  theirs: unknown;
}

/**
 * What the resolver has to work with for one conflicted file.
 *
 * `fields` and `body` are the merged result — every change only one side made is
 * already applied — so composing a settlement is: take these, then override the
 * disputed keys and body hunks with the person's choices. `bodySides` is present
 * only when the body itself is in dispute, and holds the two copies because
 * there is no base text to show: the manifest keeps a digest of a body, never a
 * copy of it.
 */
export interface ImportMergeDetail {
  fields: Record<string, unknown>;
  body: string;
  disputed: readonly MergeFieldDispute[];
  bodySides?: { ours: string; theirs: string };
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

