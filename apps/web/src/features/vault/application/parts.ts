import { getContainer } from "@/bootstrap";
import type { AppLogInput } from "@/lib/error-report/app-log";
import { readyCore } from "@/lib/rust-core";
import {
  type ILibraryPinRepository,
  type IReadingListItemRepository,
  type IReadingListRepository,
  type IShareRepository,
  type IVaultPageRepository,
  loadPinnedScreenData,
  mapLimit,
  type ReadingList,
  type VaultPage,
  type VaultPageSummary,
} from "@weaveforge/core";
import { unzipSync } from "fflate";

// --- create-note-from-link ---
export interface CreateNoteFromLinkDeps {
  /** Notes already known, matched by title the way titles are kept unique. */
  existing: readonly { id: string; title: string }[];
  add(title: string): Promise<{ id: string }>;
  reload(): Promise<void>;
  open(id: string): void;
}

/**
 * Resolve a `[[title]]` to a note: reuse one with the same title, else create
 * it. The editor creates notes for finished links with `open: false`, so the
 * note being typed in stays open. Returns the note id, or null for a blank title.
 */
export async function createNoteFromLink(
  title: string,
  opts: { open?: boolean } | undefined,
  deps: CreateNoteFromLinkDeps,
): Promise<string | null> {
  const key = readyCore().normalizeTitleKey(title);
  if (!key) return null;
  const index = readyCore().findTitleMatch(
    deps.existing.map((p) => p.title),
    title,
  );
  let id = index === undefined ? undefined : deps.existing[index]?.id;
  if (!id) {
    id = (await deps.add(title)).id;
    await deps.reload();
  }
  if (opts?.open !== false) deps.open(id);
  return id;
}

// --- import-notes ---
export interface ImportResult {
  created: number;
  folders: number;
  renamed: { from: string; to: string }[];
  skipped: number;
}

/** The slice of the vault facade an import uses. */
export interface ImportVault {
  /** Titles of the project's notes, for clash checks. */
  pageTitles(): Promise<readonly string[]>;
  manageVaultPage: {
    add(input: { title: string; body?: string; parentId?: string; folder?: boolean }): Promise<{ id: string }>;
  };
}

/**
 * Notes added at once. Titles are already de-duplicated up front, so the adds
 * are independent; the bound keeps a big vault from flooding the connection.
 */
const NOTE_ADD_CONCURRENCY = 4;

function relativePathOf(file: File): string {
  return readyCore().importRelativePath(file.webkitRelativePath, file.name);
}

/** Expand a .zip into synthetic File-like entries with webkitRelativePath set. */
async function expandZip(file: File): Promise<File[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(bytes);
  const out: File[] = [];
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith("/")) continue;
    const name = path.split("/").pop() ?? path;
    const blob = new Blob([data]);
    const f = new File([blob], name);
    Object.defineProperty(f, "webkitRelativePath", { value: path });
    out.push(f);
  }
  return out;
}

/**
 * Imports a picked folder or .zip of markdown (Obsidian vault / Notion export /
 * any .md tree) into the vault. Folder hierarchy → note nesting; frontmatter
 * tags → #hashtags; `[[wikilinks]]` are rewritten when titles are auto-suffixed.
 */
export async function importNotesFromFiles(
  files: File[],
  onProgress?: (done: number, total: number) => void,
  vault: ImportVault = getContainer().vault,
): Promise<ImportResult> {
  const expanded: File[] = [];
  for (const f of files) {
    if (readyCore().isZipFile(f.name)) {
      expanded.push(...(await expandZip(f)));
    } else {
      expanded.push(f);
    }
  }

  const mdFiles = expanded.filter((f) => readyCore().isMarkdownFile(f.name));
  const skipped = expanded.length - mdFiles.length;

  // Decide every folder and note title up front, against the existing project notes, so the
  // renames are known before any body is rewritten.
  const orderedFolders = readyCore().folderKeys(mdFiles.map(relativePathOf));
  const plan = readyCore().planImportTitles(
    orderedFolders,
    mdFiles.map((f) => f.name),
    await vault.pageTitles(),
  );
  const renamed = [...plan.renamed];
  const renameMap = plan.renameMap;

  // Create a note for every folder that holds (or leads to) an .md file, parents
  // first, so children can reference their parent id.
  const folderIds = new Map<string, string>();
  for (const [i, key] of orderedFolders.entries()) {
    const segs = key.split("/");
    const parentKey = segs.slice(0, -1).join("/");
    const page = await vault.manageVaultPage.add({
      title: plan.folderTitles[i]!,
      parentId: parentKey ? folderIds.get(parentKey) : undefined,
      folder: true,
    });
    folderIds.set(key, page.id);
  }

  const planned: { file: File; title: string; parentKey: string; raw: string }[] = [];
  for (const [i, f] of mdFiles.entries()) {
    planned.push({
      file: f,
      title: plan.noteTitles[i]!,
      parentKey: readyCore().folderKey(relativePathOf(f)),
      raw: await f.text(),
    });
  }

  // Folders stay sequential above (children need their parent's id). Notes
  // only point at folders, so they can go in parallel (34-24).
  let created = 0;
  await mapLimit(planned, NOTE_ADD_CONCURRENCY, async (item) => {
    const { body, tags } = readyCore().stripFrontmatter(item.raw);
    const withTags = readyCore().withTagLine(body, tags);
    const rewritten = readyCore().rewriteWikilinks(withTags, renameMap);
    await vault.manageVaultPage.add({
      title: item.title,
      body: rewritten,
      parentId: item.parentKey ? folderIds.get(item.parentKey) : undefined,
    });
    created += 1;
    onProgress?.(created, mdFiles.length);
  });

  return { created, folders: folderIds.size, renamed, skipped };
}

// --- load-link-targets ---
type Entry = { id: string; title: string };

export interface LinkTargets {
  /** Title/id pairs for `[[wikilink]]` resolution to papers. */
  paperEntries: Entry[];
  /** Title/id pairs for report section wikilinks. */
  sectionEntries: Entry[];
  /** Which targets failed to load, for the screen to say so; null when all loaded. */
  error: string | null;
}

/**
 * The vault's link targets. Each load may fail on its own; a failure is logged
 * and named rather than shown as an empty list, which made every link to a
 * paper look broken with no reason given (xlog-10).
 */
export async function loadLinkTargets(
  sources: {
    papers: () => Promise<{ papers: Entry[] }>;
    sections: () => Promise<{ flat: Entry[] }>;
  },
  log: (entry: AppLogInput) => void,
): Promise<LinkTargets> {
  const failed: string[] = [];
  const attempt = async <T>(what: string, load: () => Promise<T>): Promise<T | null> => {
    try {
      return await load();
    } catch (err) {
      failed.push(what);
      log({ level: "warn", source: "vault", message: `Could not load ${what} for note links`, detail: String(err) });
      return null;
    }
  };
  const [papersData, reportData] = await Promise.all([
    attempt("papers", sources.papers),
    attempt("report sections", sources.sections),
  ]);
  const entries = (rows: Entry[] | undefined) => (rows ?? []).map((r) => ({ id: r.id, title: r.title }));
  return {
    paperEntries: entries(papersData?.papers),
    sectionEntries: entries(reportData?.flat),
    error: readyCore().linkTargetsError(failed) ?? null,
  };
}

// --- load-vault-screen.use-case ---
export interface VaultScreenData {
  /**
   * The flat list holds **summaries**.
   *
   * The screen paints titles and body previews; the full body arrives from
   * `getById` when a page is opened. These used to be typed as `VaultPage`,
   * which claimed a body every element does not have — and a card edit written
   * back through that type persisted `body: ""` over a real note (review-2 F6).
   */
  flat: VaultPageSummary[];
  /**
   * Which of `flat` this project owns, as opposed to pinned/shared into it.
   *
   * The screen used to derive this by walking a `tree` field that nothing
   * rendered — the tree existed only to answer "is this row mine?". That made
   * the tree load-bearing in a way nothing said, and it meant a shared note
   * could be added to the tree without being recognised as unowned (or, if the
   * tree were rebuilt from the merged list, recognised as owned and so dropped
   * from both sections). An explicit set says what it means.
   */
  ownedIds: Set<string>;
  lists: ReadingList[];
  /** listId -> note ids in that list */
  membership: Map<string, Set<string>>;
  pinnedSharedBy: Map<string, string>;
  vaultCanComment: Map<string, boolean>;
  vaultCanEdit: Map<string, boolean>;
}

export class LoadVaultScreenUseCase {
  constructor(
    private readonly deps: {
      pages: IVaultPageRepository;
      lists: IReadingListRepository;
      listItems: IReadingListItemRepository;
      pins?: ILibraryPinRepository;
      shares?: IShareRepository;
    },
  ) {}

  async execute(): Promise<VaultScreenData> {
    const [owned, lists] = await Promise.all([
      // Required on the port; see `IPaperRepository.listSummaries` for why the
      // call-site fallback is gone. `ownedIds` below is derived from this, so a
      // wider read would not have changed the answer — only the payload.
      this.deps.pages.listSummaries(),
      this.deps.lists.list(),
    ]);
    const items = await this.deps.listItems.listItemsForLists(lists.map((l) => l.id));
    const membership = readyCore().listMembershipByKey(lists, items, "vaultPage");

    const merged = await loadPinnedScreenData(this.deps, {
      resourceType: "vault_page",
      owned,
      loadById: (id) => this.deps.pages.getById(id),
    });

    return {
      flat: merged.items,
      // From `owned`, not from the merged list: a pinned note is in `flat` and
      // is not ours, and conflating the two is what made a shared note either
      // disappear from the screen or read as owned.
      ownedIds: new Set(owned.map((page) => page.id)),
      lists,
      membership,
      pinnedSharedBy: merged.pinnedSharedBy,
      vaultCanComment: merged.canComment,
      vaultCanEdit: merged.canEdit,
    };
  }
}

// --- note-derivations ---
/** What the notes screen derives from its list. The rules live in wf-core `vault::page`. */
type Note = VaultPageSummary | VaultPage;

/** The other notes whose body links to the selected note's title (wf-core `note_backlinks`). */
export function noteBacklinks(
  notes: readonly Note[],
  selectedId: string | null,
): { id: string; title: string }[] {
  return readyCore().noteBacklinks(notes, selectedId ?? undefined) as { id: string; title: string }[];
}

/**
 * The notes in any chosen list and carrying any chosen tag. An empty filter keeps everything.
 * Cheap set membership, run before the ranked search (wf-core `scope_notes`, which returns the
 * positions kept; they are mapped back to the caller's objects here).
 */
export function scopeNotes<N extends Note>(
  notes: readonly N[],
  filter: {
    listFilter: readonly string[];
    tagFilter: readonly string[];
    membership: ReadonlyMap<string, ReadonlySet<string>>;
  },
): N[] {
  const membership = Object.fromEntries(
    [...filter.membership].map(([listId, ids]) => [listId, [...ids]]),
  );
  const kept = readyCore().scopeNoteIndices(
    notes,
    [...filter.listFilter],
    [...filter.tagFilter],
    membership,
  ) as number[];
  return kept
    .map((index) => notes[index])
    .filter((note): note is N => note !== undefined);
}
