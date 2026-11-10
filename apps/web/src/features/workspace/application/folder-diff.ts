import {
  type JsonDiff,
  type VaultPageBase,
  type WorkspaceProject,
} from "@weaveforge/core";
import type { ImportDiff } from "@weaveforge/wasm";
import { getContainer } from "@/bootstrap";
import { loadCore, readyCore } from "@/lib/rust-core";
import { ownedAssetFolderPaths, workspaceBodies } from "./asset-reanchor";
import { jsonDiff } from "./folder-json-import";
import { setPendingAssets, storedDigest } from "./folder-import-apply";
import { mergeBothChanged } from "./folder-merge";
import type { FolderDiff } from "./outside-edits";

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
