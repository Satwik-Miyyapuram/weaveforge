/**
 * A note edited on both sides, merged rather than argued over.
 *
 * `changedSide` answers *whether* both copies moved. This answers whether that
 * actually matters. One person adding a tag in Obsidian while another rewrote a
 * paragraph in the app is not a disagreement, and a conflict prompt that says
 * it is gets clicked through unread within a week — which is how a conflict UI
 * becomes worse than none.
 *
 * The policy is not invented here. It is `mergeRows` from `shared/`, the same
 * per-field three-way merge the offline sync already settled on for rows
 * arriving from the server, applied to frontmatter instead of columns. Two
 * mechanisms for one question is one mechanism too many.
 *
 * The body is handled apart from the fields, and only by digest. Merging prose
 * line by line needs the base *text*, and keeping a second copy of every note's
 * body in the folder to buy that is a real cost — a doubled vault — against a
 * case the fields already cover. So the body follows whichever side moved it,
 * and a body both sides rewrote is the one thing left for a person to settle.
 */

import { mergeRows, type FieldConflict, type Row } from "../shared/three-way-merge.js";
import { digestText } from "./change-origin.js";
import { parseWorkspaceFile } from "./deserialize-workspace.js";

/** The note as it stood when the two sides last agreed. */
export interface VaultPageBase {
  fields: Row;
  /** Digest, not text: enough to tell a rewrite from an untouched body. */
  bodyDigest: string;
}

/** One side's current copy. */
export interface VaultPageSide {
  fields: Row;
  body: string;
}

export interface VaultPageMerge {
  fields: Row;
  body: string;
  /** Empty when the merge settled everything. `body` appears as its own field. */
  conflicts: FieldConflict[];
}

/**
 * Merge the folder's copy and the workspace's copy over the base.
 *
 * A field only one side moved is taken from that side; a field both moved to
 * the same value is agreement. Anything left is reported rather than decided,
 * and the workspace's value stands in `fields` meanwhile — the same direction
 * the rest of this feature defaults in, where an unsettled conflict keeps what
 * is already in the app.
 */
export function mergeVaultPage(
  base: VaultPageBase,
  folder: VaultPageSide,
  workspace: VaultPageSide,
): VaultPageMerge {
  const { merged, conflicts } = mergeRows(base.fields, folder.fields, workspace.fields);

  const folderDigest = digestText(folder.body);
  const workspaceDigest = digestText(workspace.body);
  const folderMoved = folderDigest !== base.bodyDigest;
  const workspaceMoved = workspaceDigest !== base.bodyDigest;

  let body = workspace.body;
  if (folderMoved && !workspaceMoved) {
    body = folder.body;
  } else if (folderMoved && workspaceMoved && folderDigest !== workspaceDigest) {
    // Reported by digest rather than by text. A conflict record is a thing the
    // UI shows and the log may keep; two full note bodies is not what belongs
    // in either, and the two copies are both on hand for anything that needs
    // to display them.
    conflicts.push({
      field: "body",
      base: base.bodyDigest,
      local: folderDigest,
      remote: workspaceDigest,
    });
  }

  return { fields: merged, body, conflicts };
}

/**
 * The base a mirrored file leaves behind.
 *
 * Frontmatter is kept whole and the body only as a digest. That asymmetry is
 * the whole cost argument: frontmatter is a handful of short values, while
 * keeping every note's body would double the folder — and the body is the one
 * field this merge cannot resolve anyway.
 *
 * `title` joins the fields because it is one: a note renamed on one side and
 * retagged on the other should merge like any other pair of edits.
 */
export function vaultPageBase(path: string, content: string): VaultPageBase | null {
  const parsed = parseWorkspaceFile(path, content);
  if (!parsed || parsed.type !== "vault_page") return null;
  return {
    fields: { ...parsed.fields, title: parsed.title },
    bodyDigest: digestText(parsed.body),
  };
}

/** One side of the merge, read from the file that side holds. */
export function vaultPageSide(path: string, content: string): VaultPageSide | null {
  const parsed = parseWorkspaceFile(path, content);
  if (!parsed || parsed.type !== "vault_page") return null;
  return { fields: { ...parsed.fields, title: parsed.title }, body: parsed.body };
}
