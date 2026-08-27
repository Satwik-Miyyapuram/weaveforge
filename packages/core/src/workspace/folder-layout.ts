/**
 * Where each entity lives in the workspace folder.
 *
 * Identity rule, applied everywhere: the `weaveforge-id` in frontmatter is
 * authoritative and the path is disposable. Renaming a file in Finder renames
 * the entity; it does not fork it. That is what makes the folder safe to edit
 * outside the app.
 *
 * Slugs exist purely so the folder is navigable by a human.
 */

export const WORKSPACE_META_DIR = ".weaveforge";

export type WorkspaceEntityType =
  | "vault_page"
  | "paper"
  | "reading_list"
  | "report_section"
  | "experiment"
  | "milestone"
  | "log_entry";

/** Top-level directory per entity type. */
export const ENTITY_DIRS: Record<WorkspaceEntityType, string> = {
  vault_page: "notes",
  paper: "papers",
  reading_list: "reading-lists",
  report_section: "report",
  experiment: "experiments",
  milestone: "plan",
  log_entry: "logbook",
};

/**
 * The type, spelled into the filename: `methods--a1b2c3.note.md`.
 *
 * The directory already says what a file is, but the directory is the first
 * thing that falls away — in a tab, in quick-open, in a search result, in the
 * OS "recent files" list, `methods--a1b2c3.md` could be a note, a paper's note
 * or a report section. The suffix travels with the name.
 *
 * It is a hint and never a source of truth: `weaveforge-id` frontmatter and
 * the containing directory decide what a file is, in that order, so a folder
 * written before this existed still imports and a file moved by hand into the
 * wrong directory is read as what its directory says.
 */
export const KIND_SUFFIX: Record<WorkspaceEntityType, string> = {
  vault_page: "note",
  paper: "paper",
  reading_list: "list",
  report_section: "report",
  experiment: "experiment",
  milestone: "milestone",
  log_entry: "log",
};

const SUFFIX_TO_TYPE = new Map<string, WorkspaceEntityType>(
  Object.entries(KIND_SUFFIX).map(([type, suffix]) => [suffix, type as WorkspaceEntityType]),
);

/** The type a path's suffix claims, or null when it carries none. */
export function parseKindSuffix(path: string): WorkspaceEntityType | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const match = /\.([a-z_]+)\.md$/.exec(name);
  return match ? (SUFFIX_TO_TYPE.get(match[1]!) ?? null) : null;
}

/** The filename with its kind suffix and extension removed. */
export function stripKindSuffix(name: string): string {
  return name.replace(/\.md$/, "").replace(/\.[a-z_]+$/, (suffix) =>
    SUFFIX_TO_TYPE.has(suffix.slice(1)) ? "" : suffix,
  );
}

/**
 * Filesystem-safe, human-readable slug. Reserved Windows device names get a
 * suffix — a file called `con.md` cannot be created on Windows, and a folder
 * that will not round-trip on one platform is not portable.
 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function slugFor(title: string, fallback = "untitled"): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
  if (!slug) return fallback;
  return WINDOWS_RESERVED.test(slug) ? `${slug}-file` : slug;
}

/** Short id suffix used to break slug collisions inside one directory. */
export function idSuffix(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "x";
}

export interface FolderNode {
  id: string;
  title: string;
  parentId?: string;
}

/**
 * Directory path for a tree entity, using the folder-note convention: a node
 * with children becomes a directory holding a same-named file for its own body.
 * This is what Obsidian does, and it is the shape `import-notes.ts` already
 * parses on the way in.
 */
export function treePaths(
  nodes: readonly FolderNode[],
  type: WorkspaceEntityType,
): Map<string, string> {
  const root = ENTITY_DIRS[type];
  const ext = `.${KIND_SUFFIX[type]}.md`;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childCount = new Map<string, number>();
  for (const node of nodes) {
    if (node.parentId) childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1);
  }

  // Slugs are unique per directory, so collisions are resolved per parent.
  const usedPerParent = new Map<string, Set<string>>();
  const slugOf = new Map<string, string>();
  for (const node of nodes) {
    const parentKey = node.parentId ?? "";
    let used = usedPerParent.get(parentKey);
    if (!used) {
      used = new Set<string>();
      usedPerParent.set(parentKey, used);
    }
    let slug = slugFor(node.title);
    if (used.has(slug)) slug = `${slug}--${idSuffix(node.id)}`;
    used.add(slug);
    slugOf.set(node.id, slug);
  }

  const dirCache = new Map<string, string>();
  const dirFor = (node: FolderNode, seen = new Set<string>()): string => {
    const cached = dirCache.get(node.id);
    if (cached !== undefined) return cached;
    if (seen.has(node.id)) return root; // corrupted parent chain; do not loop
    seen.add(node.id);

    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const parentDir = parent ? dirFor(parent, seen) : root;
    const dir = `${parentDir}/${slugOf.get(node.id)}`;
    dirCache.set(node.id, dir);
    return dir;
  };

  const out = new Map<string, string>();
  for (const node of nodes) {
    const slug = slugOf.get(node.id)!;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const parentDir = parent ? dirFor(parent) : root;
    // A leaf is a plain file; a node with children becomes its folder note.
    out.set(
      node.id,
      (childCount.get(node.id) ?? 0) > 0
        ? `${dirFor(node)}/${slug}${ext}`
        : `${parentDir}/${slug}${ext}`,
    );
  }
  return out;
}

/** Flat path for a non-tree entity, with an id suffix so titles may repeat. */
export function flatPath(type: WorkspaceEntityType, id: string, title: string): string {
  return `${ENTITY_DIRS[type]}/${slugFor(title)}--${idSuffix(id)}.${KIND_SUFFIX[type]}.md`;
}

/** Logbook is dated rather than titled: `logbook/2026/03/2026-03-14--ab12cd.log.md`. */
export function logPath(id: string, entryDate: string): string {
  const [year, month] = entryDate.split("-");
  return `${ENTITY_DIRS.log_entry}/${year ?? "unknown"}/${month ?? "00"}/${entryDate}--${idSuffix(id)}.${KIND_SUFFIX.log_entry}.md`;
}

/** Assets live in one tree so a body's relative links resolve from anywhere. */
export const ASSET_DIR = "assets";

/**
 * Where a stored blob lands in the folder.
 *
 * `storagePath` keeps its owner and entity segments (`{userId}/{pageId}/{file}`)
 * rather than being flattened to the filename: two notes may hold images called
 * `diagram.png`, and the segments are what stop them colliding.
 */
export function assetPath(scope: "notes" | "papers" | "report", storagePath: string): string {
  return `${ASSET_DIR}/${scope}/${storagePath}`;
}
