/**
 * Reading-list membership as tags on the member files (0.9.8). A paper or note joins a
 * list by carrying `lists: ["[[<list file name>]]"]` in its frontmatter. What the app
 * knows about that membership (id, order, note, from, duplicate-of) sits in
 * `list-notes`, keyed by list id, so it travels with the paper or note when a tool
 * renames it. Each write is a compare-and-set, retried up to MAX_WRITE_ATTEMPTS times.
 */
import type { IWorkspaceFs } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import type { LinkTarget, Links } from "./link-index";

export const MAX_WRITE_ATTEMPTS = 3;

/** What the app keeps about one membership, beside its tag. */
export interface MemberInfo {
  id?: string;
  order?: number;
  note?: string;
  from?: string;
  "duplicate-of"?: string;
}

/** A reading-list file, with the link a member's `lists` tag uses for it. */
export interface ListFile {
  id: string;
  file: string;
  /** `[[<file name minus .md>]]`. */
  link: string;
  /** The `listItemKey` of `link`. */
  key: string;
}

/** A membership read from a member file's `lists` tag. */
export interface Tagged {
  list: ListFile;
  target: LinkTarget;
  file: string;
  info: MemberInfo;
}

type Fields = Record<string, unknown>;

function tagKey(tag: string): string | undefined {
  return readyCore().listItemKey(tag);
}

/** The `lists` tags of a member file's frontmatter. */
export function tagsOf(fields: Fields): string[] {
  return Array.isArray(fields.lists) ? fields.lists.filter((t): t is string => typeof t === "string") : [];
}

/**
 * A mapping value. The frontmatter codec has no nested maps: it writes an object as its
 * JSON text and reads it back as a string, so a JSON string is parsed here.
 */
export function objectOf(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trimStart().startsWith("{")) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function notesOf(fields: Fields): Record<string, MemberInfo> {
  return (objectOf(fields["list-notes"]) ?? {}) as Record<string, MemberInfo>;
}

/**
 * The list files as tag targets. A list is named by its bare file name, as `Links.linkFor`
 * names a file, unless another list shares that name: then both are named by their path, so
 * neither tag resolves to the other list.
 */
export function listFilesOf(lists: readonly { path: string; id: string }[]): ListFile[] {
  const bare = (path: string) => path.slice(path.lastIndexOf("/") + 1, -".md".length);
  const count = new Map<string, number>();
  for (const l of lists) count.set(bare(l.path), (count.get(bare(l.path)) ?? 0) + 1);
  return lists.map(({ path, id }) => {
    const name = (count.get(bare(path)) ?? 0) > 1 ? path.slice(0, -".md".length) : bare(path);
    const link = `[[${name}]]`;
    return { id, file: path, link, key: readyCore().listItemKey(link) ?? link };
  });
}

/** Every membership a paper or note tags, given the list files and the link snapshot. */
export async function readTagged(fs: IWorkspaceFs, links: Links, lists: readonly ListFile[]): Promise<Tagged[]> {
  const byKey = new Map(lists.map((l) => [l.key, l]));
  const out: Tagged[] = [];
  for (const { target, file } of links.all()) {
    const fields = readyCore().readFrontmatter(await fs.readText(file)).frontmatter as Fields;
    for (const tag of tagsOf(fields)) {
      const key = tagKey(tag);
      const list = key === undefined ? undefined : byKey.get(key);
      if (list) out.push({ list, target, file, info: notesOf(fields)[list.id] ?? {} });
    }
  }
  return out;
}

/** `fields` with the list's tag and info set. */
export function withTag(fields: Fields, list: ListFile, info: MemberInfo): Fields {
  const lists = tagsOf(fields).filter((t) => tagKey(t) !== list.key);
  return { ...fields, lists: [...lists, list.link], "list-notes": { ...notesOf(fields), [list.id]: info } };
}

/** `fields` without the list's tag and info. */
export function withoutTag(fields: Fields, list: ListFile): Fields {
  const next: Fields = { ...fields };
  const lists = tagsOf(fields).filter((t) => tagKey(t) !== list.key);
  const notes = { ...notesOf(fields) };
  delete notes[list.id];
  if (lists.length) next.lists = lists;
  else delete next.lists;
  if (Object.keys(notes).length) next["list-notes"] = notes;
  else delete next["list-notes"];
  return next;
}

/**
 * Rewrites one member file's frontmatter, body kept. `change` returns the new fields,
 * or null to leave the file alone. A lost compare-and-set re-reads and retries, up to
 * MAX_WRITE_ATTEMPTS times, then refuses.
 */
export async function editMemberFile(
  fs: IWorkspaceFs,
  file: string,
  change: (fields: Fields) => Fields | null,
): Promise<void> {
  if (!fs.writeTextIf) throw new Error(`${file}: this workspace cannot save without overwriting outside edits.`);
  const core = readyCore();
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    const text = await fs.readText(file);
    const { frontmatter, body } = core.readFrontmatter(text);
    const fields = change({ ...(frontmatter as Fields) });
    if (!fields) return;
    const next = core.writeFrontmatter(fields, body);
    if (next === text) return;
    if (await fs.writeTextIf(file, next, text)) return;
  }
  throw new Error(`${file}: changed on disk; reload before saving.`);
}
