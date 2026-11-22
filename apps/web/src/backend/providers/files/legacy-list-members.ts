/**
 * One-time rewrite of a 0.9.6 list file (`members` / `member-notes`) to membership in each
 * member's frontmatter (0.9.7). Runs on the list read path and is idempotent.
 *
 * Order matters for crash safety: each resolved member is written first (an idempotent
 * add), then the list file is replaced without its moved keys, only if it is unchanged on
 * disk since it was read. A crash in between leaves the members carrying the membership and
 * the list file still readable; the next run adds the same membership again (no duplicate).
 * A member link that does not resolve, a member whose paper already holds a different note
 * for this list, and any note with no moved member stay in the list file. Each list file is
 * migrated on its own: one that fails is skipped and left in the 0.9.6 shape.
 */
import type { IWorkspaceFs } from "@weaveforge/core";
import { FileEntityStore, type FoundEntity, type ProjectRoot, writeIfUnchanged } from "./file-entity-store";
import { LinkIndex, type Links, type LinkTarget } from "./link-index";
import { addListMembership, listLinkFor, readMemberFields, setFrontmatterKeys } from "./member-frontmatter";

/** The 0.9.6 list row: the codec reads these only for this rewrite. */
interface LegacyRow {
  id: string;
  members?: unknown;
  memberNotes?: unknown;
}

function noteKeyOf(t: LinkTarget): string {
  return "paperId" in t ? `paper:${t.paperId}` : `note:${t.vaultPageId}`;
}

/** The link text of a legacy member: a bare string, or an object with a `link`. */
function linkOfMember(m: unknown): string | null {
  if (typeof m === "string") return m;
  const link = (m as { link?: unknown } | null)?.link;
  return typeof link === "string" ? link : null;
}

function noteOf(info: unknown): string | undefined {
  const note = (info as { note?: unknown } | null)?.note;
  return typeof note === "string" && note ? note : undefined;
}

function recordOf(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Moves one list file's resolved members to their frontmatter, then rewrites the list file. */
async function migrateOne(fs: IWorkspaceFs, file: FoundEntity<LegacyRow>, links: Links): Promise<void> {
  const link = listLinkFor(file.path);
  const notes = recordOf(file.row.memberNotes);
  const members = Array.isArray(file.row.members) ? (file.row.members as unknown[]) : [];

  const moves: { index: number; path: string; key: string; note?: string }[] = [];
  members.forEach((member, index) => {
    const raw = linkOfMember(member);
    const target = raw === null ? null : links.resolve(raw);
    const path = target ? links.pathFor(target) : null;
    if (target && path) moves.push({ index, path, key: noteKeyOf(target), note: noteOf(notes[noteKeyOf(target)]) });
  });

  // Members first: each add is idempotent, so a crash here is repeated harmlessly. A note the
  // paper already holds for this list is kept; a different legacy note is not written over it,
  // so that member stays in the list file.
  const movedIndexes = new Set<number>();
  const movedKeys = new Set<string>();
  for (const { index, path, key, note } of moves) {
    const text = await fs.readText(path);
    const existing = readMemberFields(text).listNotes[link];
    if (existing !== undefined && note !== undefined && existing !== note) continue;
    const next = addListMembership(text, link, existing ?? note);
    if (next !== text) await writeIfUnchanged(fs, path, next, text);
    movedIndexes.add(index);
    movedKeys.add(key);
  }

  // Then the list file: drop the moved members and their keys, keep everything else.
  const remaining = members.filter((_, index) => !movedIndexes.has(index));
  const keptNotes = Object.fromEntries(Object.entries(notes).filter(([key]) => !movedKeys.has(key)));
  const next = setFrontmatterKeys(file.text, {
    members: remaining.length ? remaining : null,
    "member-notes": Object.keys(keptNotes).length ? keptNotes : null,
  });
  if (next === file.text) return;
  await writeIfUnchanged(fs, file.path, next, file.text);
}

/** Rewrites every list file that still has `members` or `member-notes`. */
export async function migrateLegacyLists(fs: IWorkspaceFs, root: ProjectRoot): Promise<void> {
  const store = new FileEntityStore<LegacyRow>(fs, root, "reading_list");
  const legacy = (await store.readAll()).filter((f) => f.row.members !== undefined || f.row.memberNotes !== undefined);
  if (!legacy.length) return;
  const links = await new LinkIndex(fs, root).snapshot();
  for (const file of legacy) {
    try {
      await migrateOne(fs, file, links);
    } catch (error) {
      console.warn(`Skipped ${file.path}: left in the 0.9.6 shape.`, error);
    }
  }
}
