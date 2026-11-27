/** Shown when no project is open: a state to describe, not a failure. */
export const NO_ACTIVE_PROJECT_MESSAGE =
  "Each project has its own subfolder in the workspace folder. Open a project to write it.";

/** Thrown when no project is open, so callers can tell it from a real failure. */
export class NoActiveProjectError extends Error {
  constructor() {
    super(NO_ACTIVE_PROJECT_MESSAGE);
    this.name = "NoActiveProjectError";
  }
}

export function isNoActiveProject(error: unknown): error is NoActiveProjectError {
  return error instanceof NoActiveProjectError;
}

/** The open project's folder (its id is the folder name, 0.9.8), read per call; NoActiveProjectError when none is open. */
export function activeProjectFolder(context: { projectId: string | null }): () => string {
  return () => {
    if (!context.projectId) throw new NoActiveProjectError();
    return context.projectId;
  };
}
