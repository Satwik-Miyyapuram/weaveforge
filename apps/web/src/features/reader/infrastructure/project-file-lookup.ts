import type { IWorkspaceFs } from "@weaveforge/core";

/** The `slug--id6` name every project folder has. */
const PROJECT_DIR = /^[^/]+--[0-9a-f]{6}$/i;

/**
 * Where a paper's file is: the active project's copy, else another project
 * folder's. 0.9.7 keeps papers at the workspace root but leaves their PDFs in
 * the old project folders, and a renamed project gets a new folder. Null when
 * no non-empty copy exists. Ids are UUIDs, so a match is the same paper.
 */
export async function findProjectFile(
  fs: IWorkspaceFs,
  activeRoot: string,
  pathIn: (root: string) => string,
): Promise<string | null> {
  const own = pathIn(activeRoot);
  if (((await fs.stat(own))?.size ?? 0) > 0) return own;
  for (const entry of await fs.list("").catch(() => [])) {
    if (entry.kind !== "dir" || entry.path === activeRoot || !PROJECT_DIR.test(entry.path)) continue;
    const path = pathIn(entry.path);
    if (((await fs.stat(path))?.size ?? 0) > 0) return path;
  }
  return null;
}
