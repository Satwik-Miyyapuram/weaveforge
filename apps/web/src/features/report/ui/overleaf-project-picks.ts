/** Which account projects the Overleaf tab lists. Null means nothing chosen yet (list all). */
export interface ProjectPicksStore {
  get(): string[] | null;
  set(ids: string[] | null): void;
}

const KEY = "wf.overleaf.shownProjects";

/** This browser's choice. Storage can be missing or blocked; then nothing is remembered. */
export const browserPicksStore: ProjectPicksStore = {
  get() {
    try {
      const raw = localStorage.getItem(KEY);
      const ids: unknown = raw ? JSON.parse(raw) : null;
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : null;
    } catch {
      return null;
    }
  },
  set(ids) {
    try {
      if (ids === null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify(ids));
    } catch {
      // Not remembered; the choice still applies until the page closes.
    }
  },
};
