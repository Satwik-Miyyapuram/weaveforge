import { ProjectValidationError, type IWorkspaceFs, type Project } from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";
import { moveProjectFolder } from "@/features/workspace/application/parts";

/**
 * Give a project a new name, and move its workspace folder's files to the matching
 * `slug--id6` name straight away.
 *
 * The folder moves now rather than on the next sync: every writer resolves the
 * folder from the name, so one that ran first would start a second folder and
 * the old one would never be followed. Files that will not move stay in the old
 * folder for the next rename; the saved name stands. The save comes
 * first, so a failed save moves nothing.
 *
 * `onFolderMoved` tells the caller the old and new folder, so records keyed by
 * folder (paper field definitions) follow the project.
 */
export async function renameProject(
  project: Project,
  name: string,
  deps: {
    save: (project: Project) => Promise<void>;
    fs: IWorkspaceFs | null;
    onFolderMoved?: (from: string, to: string) => Promise<void>;
  },
): Promise<Project> {
  const trimmed = typedCore().projectName(name);
  if (!trimmed) throw new ProjectValidationError("Project name is required.");
  if (trimmed === project.name) return project;
  const renamed = { ...project, name: trimmed };
  await deps.save(renamed);
  if (deps.fs) {
    await moveProjectFolder(deps.fs, renamed).catch((e) => console.warn("project folder not moved", e));
  }
  await deps.onFolderMoved?.(typedCore().projectDir(project), typedCore().projectDir(renamed));
  return renamed;
}
