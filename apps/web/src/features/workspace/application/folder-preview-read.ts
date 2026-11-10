import {
  ASSET_DIR,
  type IWorkspaceFs,
  type WorkspaceStat,
} from "@weaveforge/core";
import { loadCore, type RustCore } from "@/lib/rust-core";
import { IMPORT_LIMITS, ImportLimitError, SKIP_TOO_BIG, type SkippedFile } from "./import-limits";

/** What a folder preview reads: notes, the project's data files and the shared assets. */
export interface PreviewFolderRead {
  files: Record<string, string>;
  jsonFiles: Record<string, string>;
  assets: Map<string, Uint8Array>;
  /** Assets left out for their size. */
  skipped: SkippedFile[];
}

/** The files a preview looks at, without descending into folders it would ignore. */
async function* previewEntries(
  core: RustCore,
  fs: IWorkspaceFs,
  projectRoot: string,
  hasProjectDir: boolean,
): AsyncIterable<WorkspaceStat> {
  for (const top of await fs.list("")) {
    if (top.kind === "file") {
      if (!hasProjectDir) yield top;
    } else if (core.readsFolder(top.path, projectRoot, hasProjectDir)) {
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
 *
 * With `only`, a note or data file is read only when listed there, and an
 * asset only when listed or named in a note that was read: an auto-apply
 * looks at what changed, not the whole folder.
 */
export async function readPreviewFolder(
  fs: IWorkspaceFs,
  projectRoot: string,
  hasProjectDir: boolean,
  only?: ReadonlySet<string>,
): Promise<PreviewFolderRead> {
  const core = await loadCore();
  const files: Record<string, string> = {};
  const jsonFiles: Record<string, string> = {};
  const assets = new Map<string, Uint8Array>();
  const assetEntries: WorkspaceStat[] = [];
  const skipped: SkippedFile[] = [];
  const wanted = (path: string) => !only || only.has(path);

  for await (const entry of previewEntries(core, fs, projectRoot, hasProjectDir)) {
    // Everything listed in a legacy flat folder is this project's.
    const ours = !hasProjectDir || entry.path.startsWith(`${projectRoot}/`);
    if (entry.path.endsWith(".md")) {
      if (ours && wanted(entry.path)) files[entry.path] = await fs.readText(entry.path);
      continue;
    }
    // The project's own data files. Read from the folder rather than assumed,
    // so a file somebody added by hand is diffed like any other.
    if (entry.path.endsWith(".json") && core.jsonKindOfPath(entry.path) !== null) {
      if (ours && wanted(entry.path)) jsonFiles[entry.path] = await fs.readText(entry.path);
      continue;
    }
    if (entry.path.startsWith(`${ASSET_DIR}/`)) assetEntries.push(entry);
  }

  // Notes link an asset by its path under the asset folder; a name found anywhere in a read note is enough.
  const texts = only ? Object.values(files) : [];
  const named = (path: string) => {
    const rest = path.slice(ASSET_DIR.length + 1);
    return texts.some((text) => text.includes(rest));
  };
  let assetBytes = 0;
  for (const entry of assetEntries) {
    if (only && !only.has(entry.path) && !named(entry.path)) continue;
    const bytes = entry.size > IMPORT_LIMITS.maxFileBytes ? null : await fs.readFile(entry.path);
    if (!bytes || bytes.byteLength > IMPORT_LIMITS.maxFileBytes) {
      skipped.push({ path: entry.path, reason: SKIP_TOO_BIG });
      continue;
    }
    assetBytes += bytes.byteLength;
    if (assetBytes > IMPORT_LIMITS.maxTotalBytes) {
      throw new ImportLimitError(
        `Folder assets exceed ${Math.round(IMPORT_LIMITS.maxTotalBytes / 1024 / 1024)} MB; refusing to continue.`,
      );
    }
    assets.set(entry.path, bytes);
  }

  return { files, jsonFiles, assets, skipped };
}
