/**
 * Import previews: diff a connected folder or a picked ZIP against the workspace.
 *
 * Preview only; nothing is written. The folder is passed in, so this module
 * holds no session state.
 */
import { ASSET_DIR, type IWorkspaceFs, type JsonDiff } from "@weaveforge/core";
import { loadCore } from "@/lib/rust-core";
import { activeProject } from "./parts";
import { diffAgainstWorkspace } from "./parts-1";
import {
  readPreviewFolder,
  sanitizeArchiveEntries,
  SKIP_TOO_BIG,
  type SkippedFile,
  stripArchiveRoot,
  unzipWithinLimits,
} from "./parts-2";
import { followProjectRename, type FolderDiff, readMirrorBase, readMirrorBases } from "./parts-3";
import type { FolderImportDiff } from "./workspace-folder-tables";

export type FolderPreview = FolderDiff & { json: JsonDiff; skipped: SkippedFile[] };

/**
 * Read the connected folder and diff it against the workspace.
 *
 * Preview only — nothing is written. This is the "edit in Obsidian, pull back
 * in" direction, and seeing "12 updated, 1 conflict" before committing to it is
 * the whole point.
 */
export async function previewConnectedFolder(
  fs: IWorkspaceFs,
  only?: ReadonlySet<string>,
): Promise<FolderPreview> {
  const project = await activeProject();
  await followProjectRename(fs, project);
  const core = await loadCore();
  const projectRoot = core.projectDir(project);
  const base = await readMirrorBase(fs, projectRoot);
  const bases = await readMirrorBases(fs, projectRoot);

  const hasProjectDir = (await fs.stat(projectRoot).catch(() => null)) !== null;
  const { files, assets, jsonFiles, skipped } = await readPreviewFolder(fs, projectRoot, hasProjectDir, only);

  return { ...(await diffAgainstWorkspace(files, assets, project, base, bases, jsonFiles)), skipped };
}

/** Diff a ZIP the user picked, without connecting a folder. */
export async function previewArchiveImport(
  bytes: Uint8Array,
): Promise<FolderImportDiff & { skipped: SkippedFile[]; json: JsonDiff }> {
  const { entries: inflated, oversize } = await unzipWithinLimits(bytes);
  const { safe, skipped } = sanitizeArchiveEntries(inflated);
  const entries = stripArchiveRoot(safe);

  const decoder = new TextDecoder();
  const files: Record<string, string> = {};
  const assets = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (entry.path.endsWith(".md")) files[entry.path] = decoder.decode(entry.bytes);
    else if (entry.path.startsWith(`${ASSET_DIR}/`)) assets.set(entry.path, entry.bytes);
  }

  return {
    ...(await diffAgainstWorkspace(files, assets, await activeProject())),
    skipped: [...oversize.map((path) => ({ path, reason: SKIP_TOO_BIG })), ...skipped],
  };
}
