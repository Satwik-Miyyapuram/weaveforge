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
 * migrated on its own: one that fails is skipped and left in the 0.9.6 shape, and reported
 * through the app log.
 *
 * Partial write: the member writes and the list write are two writes, not one transaction. If
 * the process stops between them, the members already hold the membership and the list file
 * still names them. Both stay readable, and the next run finishes the list; no duplicate is
 * written because each add is idempotent.
 *
 * Settled lists: a list whose membership values cannot be read is remembered in memory with
 * its text and its members' resolution. It is not tried again until one of those changes, so a
 * fix to a member's frontmatter alone is picked up on the next run after the list or a member
 * link changes, or after a restart. Other failures (a crash, a changed file) are retried.
 */
import type { IWorkspaceFs } from "@weaveforge/core";
import { type AppLogInput, logToApp } from "@/lib/error-report/app-log";
import { FileEntityStore, type FoundEntity, type ProjectRoot, writeIfUnchanged } from "./file-entity-store";
import { LinkIndex, type Links, type LinkTarget } from "./link-index";
import {
  addListMembership,
  listLinkFor,
  readMemberFields,
  setFrontmatterKeys,
  UnreadableFrontmatter,
} from "./member-frontmatter";

/** The 0.9.6 list row: the codec reads these only for this rewrite. */
export interface LegacyRow {
  id: string;
  members?: unknown;
  memberNotes?: unknown;
}

/** The lists that could not be read, per workspace: file path to the text and resolution they were last tried with. */
const settled = new WeakMap<IWorkspaceFs, Map<string, string>>();

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

/** The member links a legacy list still names (the ones that are strings or carry a `link`). */
export function legacyMemberLinks(row: LegacyRow): string[] {
  const members = Array.isArray(row.members) ? (row.members as unknown[]) : [];
  return members.map(linkOfMember).filter((link): link is string => link !== null);
}

/** The note a legacy list holds for this target, if any. */
export function legacyNoteOf(row: LegacyRow, target: LinkTarget): string | undefined {
  return noteOf(recordOf(row.memberNotes)[noteKeyOf(target)]);
}

/** Where each member link resolves to: the path it names, or null when it names nothing. */
function resolutionOf(row: LegacyRow, links: Links): string {
  return JSON.stringify(
    legacyMemberLinks(row).map((raw) => {
      const target = links.resolve(raw);
      return target ? links.pathFor(target) : null;
    }),
  );
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

/** Rewrites every list file that still has `members` or `member-notes`; a failure is reported and that list is left as it is. */
export async function migrateLegacyLists(
  fs: IWorkspaceFs,
  root: ProjectRoot,
  report: (input: AppLogInput) => void = logToApp,
): Promise<void> {
  const store = new FileEntityStore<LegacyRow>(fs, root, "reading_list");
  const legacy = (await store.readAll()).filter((f) => f.row.members !== undefined || f.row.memberNotes !== undefined);
  if (!legacy.length) return;
  const links = await new LinkIndex(fs, root).snapshot();
  const known = settled.get(fs) ?? new Map<string, string>();
  settled.set(fs, known);
  for (const file of legacy) {
    const key = `${resolutionOf(file.row, links)}\n${file.text}`;
    if (known.get(file.path) === key) continue;
    try {
      await migrateOne(fs, file, links);
      known.delete(file.path);
    } catch (error) {
      if (error instanceof UnreadableFrontmatter) known.set(file.path, key);
      else known.delete(file.path);
      report({
        level: "warn",
        source: "reading-lists",
        message: `Skipped ${file.path}: left in the 0.9.6 shape.`,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
