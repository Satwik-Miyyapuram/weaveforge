import { getContainer } from "@/bootstrap";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { loadCore, readyCore, type RustCore } from "@/lib/rust-core";
import {
  type IWorkspaceFs,
  type IWorkspaceGit,
  JSON_KINDS,
  type JsonDiff,
  type JsonDiffEntry,
  type JsonRow,
  type PaperRelation,
  type ReadingListItem,
  type Tag,
  type VaultPageBase,
  type WorkspaceCommit,
  type WorkspaceJsonKind,
  type WorkspaceProject,
} from "@weaveforge/core";
import type { ConflictResolution, ImportDiff, ImportDiffEntry } from "@weaveforge/wasm";
import {
  claimImportedFile,
  readMirrorBase,
  readMirrorBases,
  writeMirrorManifest,
} from "./parts-3";
import type { FolderDiff } from "./parts-3";
import {
  activeProject,
  activeProjectOrNull,
  ownedAssetFolderPaths,
  planAssetReanchor,
  workspaceBodies,
} from "./parts";
import { activeWorkspaceFs, syncToFolder } from "./workspace-folder";

export type { ConflictPicks, ConflictResolution } from "@weaveforge/wasm";

// --- folder-json-import ---
/**
 * The project's JSON data files, read back into the workspace.
 *
 * `relations.json`, `tags.json` and `reading-list-items.json` are two-way like
 * the markdown: a person can add an edge, rename a tag or drop a paper from a
 * list in the folder, and the import offers it in the same preview, with the
 * same counts, as an edited note. Separated from `workspace-folder` because that
 * module is the session's — opening a folder, mirroring it, watching it — and
 * this is the one part that writes rows rather than files.
 */
/**
 * `<project>/.weaveforge/*.json`, diffed by id against what is stored.
 *
 * Read through the container rather than a repository of this feature's own:
 * edges, tags and list membership each belong to the feature that owns them, and
 * this is the one place that has to see all three at once.
 */
export async function jsonDiff(
  folderFiles: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
  base: Readonly<Record<string, string>>,
  project: WorkspaceProject,
): Promise<JsonDiff> {
  const core = await loadCore();
  const c = getContainer();
  const [relations, tags, lists] = await Promise.all([
    c.graph.relations.getGraph(),
    c.graph.tags.list(),
    c.readingLists.allLists(),
  ]);
  const items = await c.readingLists.listItemsForLists(lists.map((list) => list.id));
  const existing: Record<WorkspaceJsonKind, JsonRow[]> = {
    relations: relations as unknown as JsonRow[],
    tags: tags as unknown as JsonRow[],
    reading_list_items: items as unknown as JsonRow[],
  };

  const projectRoot = core.projectDir(project);
  const entries: JsonDiffEntry[] = [];
  for (const kind of JSON_KINDS) {
    const path = core.jsonDataPath(projectRoot, kind);
    const text = folderFiles[path];
    if (text === undefined) continue;
    const parsed = core.parseJsonData(path, text, kind);
    // A file that will not parse says nothing. Reporting it as "no rows" would
    // read a syntax error as a removal of everything it held.
    if (!parsed) continue;
    entries.push(
      ...(core.diffJsonData(parsed, existing[kind], {
        origin: (changed) =>
          core.changedSide({
            base: base[changed] || undefined,
            folder: readyCore().digestText(text),
            workspace: current[changed] === undefined ? undefined : readyCore().digestText(current[changed]),
          }),
        // The generated row type is a plain record; the rows are the ones passed in.
      }).entries as JsonDiffEntry[]),
    );
  }
  return { entries, counts: core.countJsonActions(entries) };
}

/**
 * Write the folder's JSON rows into the workspace.
 *
 * An update is a `save` with the row as the folder has it, including its id: the
 * id is how these rows are identified, and the repository is what can write one
 * with the id it already has.
 */
export async function applyJsonEntries(json: JsonDiff | undefined): Promise<string[]> {
  if (!json || json.entries.length === 0) return [];
  const c = getContainer();
  const files = new Set<string>();

  for (const entry of json.entries) {
    // A conflict is the reader's to settle, and a JSON row has no per-field
    // merge: applying one side or the other would be a guess at which.
    if (entry.action === "unchanged" || entry.action === "conflict") continue;
    if (entry.kind === "relations") {
      if (entry.action === "removed") await c.graph.relations.delete(entry.existing.id);
      else await c.graph.relations.save(entry.row as unknown as PaperRelation);
    } else if (entry.kind === "tags") {
      if (entry.action === "removed") await c.graph.tags.delete(entry.existing.id);
      else await c.graph.tags.save(entry.row as unknown as Tag);
    } else {
      if (entry.action === "removed") await c.readingLists.items.remove(entry.existing.id);
      else await c.readingLists.items.add(entry.row as unknown as ReadingListItem);
    }
    files.add(entry.path);
  }
  return [...files];
}

/**
 * Record what the folder says for the files an import applied.
 *
 * The two sides agree at that moment, and the base has to say so: the digest it
 * held was the one the app would have written, not the one the reader's edit
 * produced, and leaving it would keep the mirror holding those files back
 * forever — the folder would never be brought back into step.
 *
 * A path whose text no longer matches its `expected` digest moved after the preview.
 * The workspace now holds the applied text, so that digest becomes the base and
 * the next look reads the newer edit as the folder's alone, not as both sides'.
 */
export async function refreshMirrorBase(
  fs: IWorkspaceFs | null,
  paths: readonly string[],
  expected: Readonly<Record<string, string>> = {},
): Promise<void> {
  if (!fs || paths.length === 0) return;
  const project = await activeProjectOrNull().catch(() => null);
  if (!project) return;
  const core = await loadCore();
  const projectRoot = core.projectDir(project);
  const base = await readMirrorBase(fs, projectRoot);
  const bases = await readMirrorBases(fs, projectRoot);
  let touched = false;
  for (const path of paths) {
    const text = await fs.readText(path).catch(() => null);
    if (text === null) continue;
    const applied = expected[path];
    const digest = readyCore().digestText(text);
    // A digest the base already holds is a write the apply made itself, such as an id stamp.
    if (applied !== undefined && digest !== applied && digest !== base[path]) {
      base[path] = applied;
      touched = true;
      continue;
    }
    base[path] = digest;
    // A note over the WASM text limit keeps no field base; the next merge
    // of it then reports a conflict instead of guessing.
    let pageBase: ReturnType<typeof core.vaultPageBase> = null;
    try {
      pageBase = core.vaultPageBase(path, text);
    } catch {
      pageBase = null;
    }
    if (pageBase) bases[path] = pageBase;
    touched = true;
  }
  if (touched) await writeMirrorManifest(fs, projectRoot, Object.keys(base), base, bases);
}

// --- folder-merge ---
/**
 * Settling a file both sides changed.
 *
 * The conflict policy lives in wf-core (`sync::folder_merge`); this module keeps the
 * app-side guards and the file write, and re-exports the wasm types the UI uses.
 */
/**
 * Settle a both-changed file per field, or say what is actually in dispute.
 *
 * The folder's side is taken from the entry rather than re-read from the file,
 * because the entry's body has already had this account's asset links restored.
 * A folder with no recorded base stays a conflict for the person to decide.
 */
export function mergeBothChanged(
  core: RustCore,
  entry: ImportDiffEntry,
  base: VaultPageBase | undefined,
  workspaceContent: string | undefined,
): ImportDiffEntry {
  // A note over the WASM text limit cannot be merged here; it stays a conflict for the person to settle.
  if ((workspaceContent?.length ?? 0) > MAX_INDEX_TEXT_UTF16) return entry;
  let merged: ImportDiffEntry;
  try {
    merged = core.mergeBothChanged(entry, base, workspaceContent);
  } catch {
    return entry;
  }
  // The core hands back the entry unchanged when there is no base, no workspace copy, or no
  // vault page to read; keep the caller's own object in that case.
  if (merged.action === entry.action && merged.merge === undefined) return entry;
  return merged;
}

/** The index text limit, in UTF-16 units, that the WASM core enforces. */
const MAX_INDEX_TEXT_UTF16 = 16 * 1024 * 1024;

/**
 * Turn a settled conflict into an ordinary entry, or `null` to leave it alone.
 *
 * Markers, keep, and picks with nothing to compose from all settle to `null` in wf-core.
 */
export function settleConflict(
  core: RustCore,
  entry: ImportDiffEntry,
  resolutions: Readonly<Record<string, ConflictResolution>>,
): ImportDiffEntry | null {
  if (entry.action !== "conflict") return entry;
  return core.settleConflict(entry, resolutions) ?? null;
}

/**
 * Put this app's copy and the folder's copy into the file, marked, for a person
 * to settle in whatever they edit in.
 *
 * Only the body is marked. Frontmatter is not marked at all: it is key-value data,
 * and where two keys disagree the resolver settles them one at a time.
 *
 * Nothing reaches the workspace here. The file now differs from the recorded
 * base, so the mirror holds it back until the markers are gone.
 */
export async function writeConflictMarkersTo(
  core: RustCore,
  fs: IWorkspaceFs,
  entry: ImportDiffEntry,
): Promise<boolean> {
  const sides = entry.merge?.bodySides;
  if (!sides) return false;

  const current = await fs.readText(entry.entity.path).catch(() => null);
  if (current === null) return false;

  const { frontmatter } = core.readFrontmatter(current);
  await fs.writeFile(
    entry.entity.path,
    core.writeFrontmatter(frontmatter, core.writeConflictMarkers(sides.ours, sides.theirs)),
  );
  return true;
}

// --- folder-import-apply ---

let pendingAssets = new Map<string, Uint8Array>();

/**
 * Notes made from a hand-written file whose id could not be written back into
 * it, by path. That file still has no id, so the next preview offers it as new
 * again; this lets the next apply update the note it made instead of adding a
 * second one.
 */
const unclaimed = new Map<string, string>();

export function setPendingAssets(assets: Map<string, Uint8Array>): void {
  pendingAssets = assets;
}

export function clearPendingAssets(): void {
  pendingAssets = new Map();
}

/** For a run started in the background against one folder. */
export interface ApplyOptions {
  /** The folder the diff was read from; the apply refuses if another is connected now. */
  fs?: IWorkspaceFs;
  /** Digest per path when previewed; a file that moved since keeps its old base. */
  expected?: Readonly<Record<string, string>>;
  /**
   * Each note's `storedDigest` when previewed, by id. A note written in the app
   * since (server sync, an agent, a late editor flush) is not overwritten; its
   * path comes back in `moved`.
   */
  stored?: Readonly<Record<string, string>>;
  /** Paths that are renames (`renamedPaths`): retitled from the new name, then left to the mirror to write. */
  renamed?: ReadonlySet<string>;
}

/** A note's title and body as one digest: what an update would overwrite. */
export function storedDigest(page: { title: string; body: string }): string {
  return readyCore().digestText(`${page.title}
${page.body}`);
}

/**
 * Apply what the user chose from the preview: create and update notes.
 *
 * Conflicted files have already been resolved (in memory) to one of the two
 * copies, or to a compose made of hunk-level picks. Throws when no folder is
 * connected, so the import screen says so rather than reporting nothing done.
 */
export async function applyFolderImport(
  diff: ImportDiff & { json?: JsonDiff },
  resolutions: Readonly<Record<string, ConflictResolution>> = {},
  options: ApplyOptions = {},
): Promise<{ created: number; updated: number; moved: string[] }> {
  const fs = activeWorkspaceFs();
  if (!fs) throw new Error("No workspace folder is connected. Connect one in Settings, then import again.");
  if (options.fs && options.fs !== fs) throw new Error("The folder changed before its edits were taken in.");

  const result = await applyEntries(fs, diff, resolutions, options.stored, options.renamed);
  const appliedJson = await applyJsonEntries(diff.json);
  // What was applied, the two sides now agree on: the folder's text becomes
  // the base, or the mirror would keep holding those files back for an edit
  // that has already landed. Settled conflicts are included here.
  await refreshMirrorBase(fs, [
    ...result.appliedPaths,
    ...appliedJson,
  ], options.expected ?? {});

  await syncToFolder().catch(() => undefined);
  return { created: result.created, updated: result.updated, moved: result.moved };
}

/**
 * Answer a held outside edit with the workspace's copy: write it over the folder's file and make that
 * the base, so the edit no longer waits. False when the workspace writes nothing at that path.
 */
export async function keepWorkspaceCopy(fs: IWorkspaceFs, path: string): Promise<boolean> {
  const core = await loadCore();
  const snapshot = await getContainer().workspace.snapshot();
  const text = core.serializeWorkspace(snapshot, await activeProject()).files[path];
  if (text === undefined) return false;
  await fs.writeFile(path, text);
  await refreshMirrorBase(fs, [path]);
  return true;
}

/** See `writeConflictMarkersTo`: this window's folder gets the markers. */
export async function writeMarkersFor(entry: ImportDiffEntry): Promise<boolean> {
  const fs = activeWorkspaceFs();
  if (!fs) return false;
  return writeConflictMarkersTo(await loadCore(), fs, entry);
}

/** @internal exported for tests */
export async function applyEntries(
  fs: IWorkspaceFs,
  diff: ImportDiff,
  resolutions: Readonly<Record<string, ConflictResolution>>,
  stored?: Readonly<Record<string, string>>,
  renamed: ReadonlySet<string> = new Set(),
): Promise<{ created: number; updated: number; appliedPaths: string[]; moved: string[] }> {
  const core = await loadCore();
  const container = getContainer();
  const owned = ownedAssetFolderPaths(workspaceBodies(await container.workspace.snapshot()));
  const projectRoot = core.projectDir(await activeProject());
  let created = 0;
  let updated = 0;
  const appliedPaths: string[] = [];
  const moved: string[] = [];

  for (const raw of diff.entries) {
    const entry = raw.action === "conflict" ? settleConflict(core, raw, resolutions) : raw;
    if (!entry) continue;

    if (entry.action === "conflict" || entry.action === "unchanged" || entry.action === "removed") {
      continue;
    }

    if (entry.action === "created") {
      const path = entry.entity.path;
      const earlier = path ? unclaimed.get(path) : undefined;
      const made = earlier ? await container.vault.getPage(earlier) : null;
      let id: string;
      if (made) {
        await container.vault.manageVaultPage.update(made.id, {
          title: entry.entity.title,
          body: await reanchorAssets(entry.entity.body, made.id, owned),
        });
        id = made.id;
        updated += 1;
      } else {
        const page = await container.vault.manageVaultPage.add({
          title: entry.entity.title,
          body: await reanchorAssets(entry.entity.body, "new", owned),
        });
        id = page.id;
        created += 1;
      }
      if (path) {
        try {
          await claimImportedFile(fs, path, id, projectRoot);
          unclaimed.delete(path);
        } catch {
          unclaimed.set(path, id);
        }
      }
      appliedPaths.push(path);
      continue;
    }

    if (!entry.entity.id) continue;
    const page = await container.vault.getPage(entry.entity.id);
    if (!page) continue;
    const seen = stored?.[page.id];
    if (seen !== undefined && storedDigest(page) !== seen) {
      moved.push(entry.entity.path);
      continue;
    }
    const path = entry.entity.path;
    const rename = renamed.has(path);
    // A renamed file still carries the old title in its frontmatter; the new name says what it is now.
    const title = rename && entry.entity.title === page.title ? titleFromFileName(path) : entry.entity.title;
    await container.vault.manageVaultPage.update(page.id, {
      title,
      body: await reanchorAssets(entry.entity.body, page.id, owned),
    });
    updated += 1;
    if (!rename) {
      appliedPaths.push(path);
      continue;
    }
    // The note is whole in the workspace now; the mirror writes it at the path its title gives.
    await fs.remove(path).catch(() => undefined);
  }

  pendingAssets = new Map();
  return { created, updated, appliedPaths, moved };
}

/**
 * Turn an imported body's relative image links back into storage references.
 */
async function reanchorAssets(
  body: string,
  pageId: string,
  owned: ReadonlySet<string>,
): Promise<string> {
  const plan = planAssetReanchor(body, owned, new Set(pendingAssets.keys()));
  if (plan.keep.length === 0 && plan.upload.length === 0) return body;

  const resolved = new Map<string, string>();
  for (const ref of plan.keep) resolved.set(ref.folderPath, ref.storagePath);

  for (const ref of plan.upload) {
    const bytes = pendingAssets.get(ref.folderPath)!;
    const ext = readyCore().assetExtension(ref.storagePath);
    const blob = new Blob([bytes as BlobPart], { type: readyCore().assetMimeType(ext) });
    resolved.set(ref.folderPath, await getContainer().vault.uploadAsset(pageId, blob, ext));
  }

  const core = await loadCore();
  return core.fromRelativeBlobLinks(body, Object.fromEntries(resolved));
}

/** The title a renamed file's name gives: no folder, kind suffix or id suffix. */
export function titleFromFileName(path: string): string {
  return readyCore().folderTitleFromPath(path);
}

// --- folder-diff ---
/** What importing a folder or a ZIP would change in the workspace. */

export async function diffAgainstWorkspace(
  files: Record<string, string>,
  assets: Map<string, Uint8Array>,
  /**
   * The project being compared. The paths the mirror would write are inside its
   * folder, so the same file in two projects is two different paths.
   */
  project: WorkspaceProject,
  /**
   * What the folder said when the two sides last agreed, by path.
   *
   * Absent for an archive import: a ZIP has no shared history with this
   * workspace, so every difference is the user's to judge.
   */
  base: Readonly<Record<string, string>> = {},
  /** Frontmatter and body digests from the same manifest, for the merge. */
  bases: Readonly<Record<string, VaultPageBase>> = {},
  /** The three JSON data files, when the caller has them. A ZIP has none. */
  jsonFiles: Record<string, string> = {},
): Promise<FolderDiff & { json: JsonDiff }> {
  const core = await loadCore();
  const snapshot = await getContainer().workspace.snapshot();
  const existing = [
    ...snapshot.vaultPages.map((page) => ({
      id: page.id,
      type: "vault_page" as const,
      title: page.title,
      body: page.body,
    })),
    ...snapshot.papers.map((paper) => ({
      id: paper.id,
      type: "paper" as const,
      title: paper.title,
      body: paper.summary ?? "",
    })),
  ];

  setPendingAssets(assets);
  const owned = ownedAssetFolderPaths(workspaceBodies(snapshot));
  // folder path (`assets/<scope>/<path>`) -> storage path, which is the path itself.
  const ownedStorage = Object.fromEntries(
    [...owned].map((folderPath) => [folderPath, folderPath.split("/").slice(2).join("/")]),
  );
  const noteIds = new Set(snapshot.vaultPages.map((page) => page.id));
  // Only notes import; an experiment or paper file would otherwise read as a new note.
  const parsed = readyCore().importableEntities(core.parseWorkspaceFolder(files), noteIds).map((entity) => ({
    ...entity,
    // Restore links to assets this account already owns before comparing.
    // Without it every note holding an image reads as changed on every import,
    // because the folder spells the reference `../assets/…` and the database
    // spells the same reference `vault:…`.
    body: core.fromRelativeBlobLinks(entity.body, ownedStorage),
  }));

  // What the mirror would write from the workspace as it stands now. Compared
  // against the same base as the folder's copy, this is what says whether the
  // difference came from out there or in here.
  const current = core.serializeWorkspace(snapshot, project).files;

  const diff = core.diffWorkspace(parsed, existing, {
    origin: (path) =>
      core.changedSide({
        // A version 1 manifest recorded the path and no digest, which reads
        // as an empty string here and must not be mistaken for a file whose
        // contents hashed to nothing.
        base: base[path] || undefined,
        folder: files[path] === undefined ? undefined : readyCore().digestText(files[path]),
        workspace: current[path] === undefined ? undefined : readyCore().digestText(current[path]),
      }),
    // The generated `fields` type is a plain record; the entities are the parsed ones above.
  }) as ImportDiff;

  // A file both sides changed is only a conflict if the changes collide. Most
  // do not: a tag added in Obsidian and a paragraph rewritten here are two
  // edits to one note, not two answers to one question.
  const entries = diff.entries.map((entry) =>
    mergeBothChanged(core, entry, bases[entry.entity.path], current[entry.entity.path]),
  );

  // The JSON data files are the same question asked of rows rather than prose,
  // and they are shown in the same preview: one list of what would change, one
  // set of numbers.
  const json = await jsonDiff(jsonFiles, current, base, project);
  const seen = core.seenFiles(
    { ...files, ...jsonFiles },
    current,
    base,
    core.renameSources(parsed, files, current),
  );
  const stored = Object.fromEntries(snapshot.vaultPages.map((page) => [page.id, storedDigest(page)]));
  return { entries, counts: core.addCounts(readyCore().countActions(entries), json.counts), json, seen, stored };
}

// --- folder-file-history ---
/** Earlier versions of one folder file: the commits that changed it, and its text at each. */
export interface FileHistorySource {
  log(path: string, limit: number): Promise<readonly WorkspaceCommit[]>;
  /** The file's text at `oid`; null when it is absent there, too big or not text. */
  readAt(oid: string, path: string): Promise<string | null>;
}

/** History read by the desktop shell, or null on a shell too old to have it. */
export function shellFileHistory(
  shell: Partial<Pick<DesktopBridge, "vaultFileLog" | "vaultReadAt">>,
): FileHistorySource | null {
  const { vaultFileLog, vaultReadAt } = shell;
  if (!vaultFileLog || !vaultReadAt) return null;
  return {
    log: (path, limit) => vaultFileLog.call(shell, path, limit),
    readAt: (oid, path) => vaultReadAt.call(shell, oid, path),
  };
}

/** History read by the renderer's own git (a browser folder). */
export function gitFileHistory(git: IWorkspaceGit): FileHistorySource {
  return {
    log: (path, limit) => git.log({ path, limit }),
    readAt: async (oid, path) => {
      const bytes = await git.readAt(oid, path);
      if (!bytes) return null;
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return null;
      }
    },
  };
}
