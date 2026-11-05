/**
 * Keeping the folder in step with the database, with the decisions made in Rust.
 *
 * The mirror is one-way and best-effort: the database is the source of truth and the
 * folder a projection of it. WASM cannot await the folder's file system, so this reads
 * the text the plan needs, lets Rust `planMirror` decide what to write, hold and remove,
 * and then applies that plan here, assets included (fetching them is async too).
 */

import type { IWorkspaceFs, MirrorResult, WorkspaceProject, WorkspaceSnapshot } from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";

/** The folder that holds `path`, or "" for a root-level file such as README.md. */
function parentDir(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

/**
 * Write a snapshot to the folder, removing files that no longer belong. Same contract
 * as the TS `mirrorWorkspace` it replaces: unchanged files are not rewritten, a file the
 * reader edited since the last run is held back, and only paths the last run wrote can
 * be removed.
 */
export async function mirrorWorkspace(
  core: RustCore,
  snapshot: WorkspaceSnapshot,
  fs: IWorkspaceFs,
  options: {
    /** The project this snapshot belongs to; every path is inside its folder. */
    project: WorkspaceProject;
    /** Paths written by the previous run, so departures can be detected. */
    previousPaths?: readonly string[];
    /** The digest of each path the last run wrote, from the project's manifest. */
    base?: Readonly<Record<string, string>>;
    /** Fetch a blob for an asset the folder references. */
    fetchAsset?(storagePath: string): Promise<Uint8Array | null>;
  },
): Promise<MirrorResult> {
  const serialized = core.serializeWorkspace(snapshot, options.project);
  const { files, assets } = serialized;
  const previousPaths = options.previousPaths ?? [];
  const { base } = options;

  // The plan reads every file it may write, and a departed file only when a base digest
  // could make it a reader's edit; nothing else.
  const present = new Set([...Object.keys(files), ...assets.map((asset) => asset.folderPath)]);
  const departedWithBase = previousPaths.filter(
    (path) => !present.has(path) && base !== undefined && Object.hasOwn(base, path),
  );
  // No prototype, so a path can never collide with an inherited key.
  const disk: Record<string, string> = Object.create(null);
  for (const path of [...Object.keys(files), ...departedWithBase]) {
    const text = await fs.readText(path).catch(() => null);
    if (text !== null) disk[path] = text;
  }

  const plan = core.planMirror(serialized, previousPaths, base, disk);

  const written = [...plan.written];
  for (const path of plan.written) {
    const dir = parentDir(path);
    if (dir) await fs.mkdirp(dir);
    await fs.writeFile(path, files[path] ?? "");
  }

  let unchanged = plan.unchanged;
  if (options.fetchAsset) {
    for (const asset of assets) {
      // Assets are immutable once written: the storage path holds a uuid, so an existing
      // path is the same file and re-fetching it would be a download for nothing.
      if (await fs.stat(asset.folderPath).catch(() => null)) {
        unchanged += 1;
        continue;
      }
      const bytes = await options.fetchAsset(asset.storagePath);
      if (!bytes) continue;
      const dir = parentDir(asset.folderPath);
      if (dir) await fs.mkdirp(dir);
      await fs.writeFile(asset.folderPath, bytes);
      written.push(asset.folderPath);
    }
  }

  // Best-effort: a file already gone is the outcome asked for.
  for (const path of plan.removed) await fs.remove(path).catch(() => undefined);

  return {
    written,
    removed: plan.removed,
    unchanged,
    heldBack: plan.heldBack,
    mirrored: Object.fromEntries(plan.mirrored),
    bases: Object.fromEntries(plan.bases),
  };
}
