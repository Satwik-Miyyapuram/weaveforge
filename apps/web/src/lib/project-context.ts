/**
 * Mutable holder for the currently-selected project. A single instance is
 * created at the composition root and injected into every project-scoped
 * repository; repositories read `projectId` at query time, so switching project
 * (updating this field) re-scopes all reads/writes without rebuilding anything.
 */
export interface ProjectContext {
  projectId: string | null;
}
