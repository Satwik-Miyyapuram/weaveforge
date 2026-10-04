import { idSuffix, projectDir, type IWorkspaceFs, type WorkspaceProject } from "@weaveforge/core";

/**
 * Remove a deleted project's folder from the workspace.
 *
 * Found by its `--id6` suffix as well as its current name, so a folder named
 * before a rename still goes. Returns the folder removed, or null.
 */
export async function removeProjectFolder(fs: IWorkspaceFs, project: WorkspaceProject): Promise<string | null> {
  const exact = projectDir(project);
  const tail = `--${idSuffix(project.id)}`;
  const dirs = (await fs.list("")).filter((s) => s.kind === "dir").map((s) => s.path.split("/").pop() ?? "");
  const match = dirs.includes(exact) ? exact : dirs.filter((d) => d.endsWith(tail)).length === 1 ? dirs.find((d) => d.endsWith(tail))! : null;
  if (!match) return null;
  await fs.remove(match, { recursive: true });
  return match;
}
