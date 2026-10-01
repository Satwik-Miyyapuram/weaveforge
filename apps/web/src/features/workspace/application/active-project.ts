import { projectDir, type WorkspaceProject } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";

/**
 * Which project a folder path belongs to.
 *
 * Every mirrored path is inside one project's folder, so anything that resolves
 * a folder path has to answer this first — the serializer, the mirror manifest,
 * the PDF and HTML caches, the editor's tree, the export, the MCP server. It
 * reads the container rather than a module-level variable, because the answer
 * changes as the reader switches project and a cached one would write the wrong
 * project's work into the wrong folder.
 *
 * A failure is loud on purpose. Every previous version of this question had a
 * silent fallback — "no project" meant the root — and that is how a run for one
 * project came to delete another's files. A caller with no project has nowhere
 * to write, and saying so is better than writing somewhere plausible.
 */
export async function activeProjectOrNull(): Promise<WorkspaceProject | null> {
  const projects = getContainer().projects;
  const id = projects.context.projectId;
  if (!id) return null;
  const project = (await projects.listProjects()).find((candidate) => candidate.id === id);
  return project ? { id: project.id, name: project.name } : null;
}

export async function activeProject(): Promise<WorkspaceProject> {
  const project = await activeProjectOrNull();
  if (!project) {
    const id = getContainer().projects.context.projectId;
    throw new Error(
      id
        ? `The open project (${id}) is not in the project list, so its folder cannot be named. Reopen it, then try again.`
        : "Each project has its own subfolder in the workspace folder. Open a project to write it.",
    );
  }
  return project;
}

/** The active project's folder, which is what every path builder wants. */
export async function activeProjectRoot(): Promise<string> {
  return projectDir(await activeProject());
}
