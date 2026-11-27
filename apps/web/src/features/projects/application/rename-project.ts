import { ProjectValidationError, type Project } from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";

/**
 * Give a project a new name. In files mode the project is its folder, so
 * `rename` moves the folder and the id (the folder name) changes with it; a
 * failed rename moves nothing.
 *
 * `onFolderMoved` tells the caller the old and new folder, so records keyed by
 * folder (paper field definitions) follow the project.
 */
export async function renameProject(
  project: Project,
  name: string,
  deps: {
    rename: (project: Project, name: string) => Promise<Project>;
    onFolderMoved?: (from: string, to: string) => Promise<void>;
  },
): Promise<Project> {
  const trimmed = typedCore().projectName(name);
  if (!trimmed) throw new ProjectValidationError("Project name is required.");
  if (trimmed === project.name) return project;
  const renamed = await deps.rename(project, trimmed);
  if (renamed.id !== project.id) await deps.onFolderMoved?.(project.id, renamed.id);
  return renamed;
}
