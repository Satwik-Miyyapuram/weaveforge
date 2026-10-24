import {
  ASSET_DIR,
  WORKSPACE_META_DIR,
  jsonKindOfPath,
  type IWorkspaceFs,
  type WorkspaceStat,
} from "@weaveforge/core";
import { IMPORT_LIMITS, ImportLimitError } from "./import-limits";

/** What a folder preview reads: notes, the project's data files and the shared assets. */
export interface PreviewFolderRead {
  files: Record<string, string>;
  jsonFiles: Record<string, string>;
  assets: Map<string, Uint8Array>;
}

/** A top-level `<slug>--<id6>` folder: some project's, maybe not this one. */
const PROJECT_FOLDER = /^[^/]+--[a-zA-Z0-9]{1,8}$/;

/**
 * Whether a top-level folder can hold anything the preview reads. Git's own
 * folder never can; a project folder only reads its own and the shared assets.
 */
function readsFolder(name: string, projectRoot: string, hasProjectDir: boolean): boolean {
  if (name === ".git") return false;
  if (name === projectRoot || name === ASSET_DIR) return true;
  if (hasProjectDir) return false;
  return name !== WORKSPACE_META_DIR && !PROJECT_FOLDER.test(name);
}

/** The files a preview looks at, without descending into folders it would ignore. */
async function* previewEntries(
  fs: IWorkspaceFs,
  projectRoot: string,
  hasProjectDir: boolean,
): AsyncIterable<WorkspaceStat> {
  for (const top of await fs.list("")) {
    if (top.kind === "file") {
      if (!hasProjectDir) yield top;
    } else if (readsFolder(top.path, projectRoot, hasProjectDir)) {
      yield* fs.walk(top.path);
    }
  }
}

/**
 * Read the connected folder for an import preview.
 *
 * A project folder reads its own notes and data files; a legacy flat folder
 * (no project folder yet) reads its top level. Both read the shared assets.
 * An asset over the file cap is skipped on its listed size, before its bytes
 * are read, and the assets together may not pass the total cap.
 */
export async function readPreviewFolder(
  fs: IWorkspaceFs,
  projectRoot: string,
  hasProjectDir: boolean,
): Promise<PreviewFolderRead> {
  const files: Record<string, string> = {};
  const jsonFiles: Record<string, string> = {};
  const assets = new Map<string, Uint8Array>();
  let assetBytes = 0;

  for await (const entry of previewEntries(fs, projectRoot, hasProjectDir)) {
    // Everything listed in a legacy flat folder is this project's.
    const ours = !hasProjectDir || entry.path.startsWith(`${projectRoot}/`);
    if (entry.path.endsWith(".md")) {
      if (ours) files[entry.path] = await fs.readText(entry.path);
      continue;
    }
    // The project's own data files. Read from the folder rather than assumed,
    // so a file somebody added by hand is diffed like any other.
    if (entry.path.endsWith(".json") && jsonKindOfPath(entry.path) !== null) {
      if (ours) jsonFiles[entry.path] = await fs.readText(entry.path);
      continue;
    }
    if (!entry.path.startsWith(`${ASSET_DIR}/`)) continue;
    if (entry.size > IMPORT_LIMITS.maxFileBytes) continue;
    const bytes = await fs.readFile(entry.path);
    if (bytes.byteLength > IMPORT_LIMITS.maxFileBytes) continue;
    assetBytes += bytes.byteLength;
    if (assetBytes > IMPORT_LIMITS.maxTotalBytes) {
      throw new ImportLimitError(
        `Folder assets exceed ${Math.round(IMPORT_LIMITS.maxTotalBytes / 1024 / 1024)} MB; refusing to continue.`,
      );
    }
    assets.set(entry.path, bytes);
  }

  return { files, jsonFiles, assets };
}
