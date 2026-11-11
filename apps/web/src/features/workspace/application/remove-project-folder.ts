import { type IWorkspaceFs, type WorkspaceProject } from "@weaveforge/core";
import { loadCore, typedCore } from "@/lib/rust-core";

/**
 * Remove a deleted project's folder from the workspace.
 *
 * Found by its `--id6` suffix as well as its current name, so a folder named
 * before a rename still goes. Returns the folder removed, or null.
 */
export async function removeProjectFolder(fs: IWorkspaceFs, project: WorkspaceProject): Promise<string | null> {
  const core = await loadCore();
  const exact = core.projectDir(project);
  const tail = `--${typedCore().idSuffix(project.id)}`;
  const dirs = (await fs.list("")).filter((s) => s.kind === "dir").map((s) => s.path.split("/").pop() ?? "");
  const match = typedCore().pickProjectFolder(dirs, exact, tail) ?? null;
  if (!match) return null;
  await fs.remove(match, { recursive: true });
  return match;
}
