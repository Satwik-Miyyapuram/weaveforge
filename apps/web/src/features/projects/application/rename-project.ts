import { ProjectValidationError, type IWorkspaceFs, type Project } from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";
import { followProjectRename } from "@/features/workspace/application/parts-3";

/**
 * Give a project a new name, and carry its workspace folder to the matching
 * `slug--id6` name straight away.
 *
 * The folder moves now rather than on the next sync: every writer resolves the
 * folder from the name, so one that ran first would start a second folder and
 * the old one would never be followed. A folder that will not move is left to
 * the next sync, which tries again; the saved name stands. The save comes
 * first, so a failed save moves nothing.
 */
export async function renameProject(
  project: Project,
  name: string,
  deps: { save: (project: Project) => Promise<void>; fs: IWorkspaceFs | null },
): Promise<Project> {
  const trimmed = typedCore().projectName(name);
  if (!trimmed) throw new ProjectValidationError("Project name is required.");
  if (trimmed === project.name) return project;
  const renamed = { ...project, name: trimmed };
  await deps.save(renamed);
  if (deps.fs) {
    await followProjectRename(deps.fs, renamed).catch((e) => console.warn("project folder not moved", e));
  }
  return renamed;
}
