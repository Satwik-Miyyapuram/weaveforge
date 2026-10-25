import type { IProjectBibliographyCollectionStore } from "@weaveforge/core";
import { logToApp } from "@/lib/error-report/app-log";
import { describeRejection } from "@/lib/format-error";

/**
 * The collection "read Zotero on this computer" imports: the same per-project
 * collection the cloud sync reads. `undefined` — no project, none chosen, or a
 * setting that cannot be read — means the whole library, a superset of it, so
 * a reader gets their papers rather than an error about a setting. The failed
 * read is logged, because the import then quietly takes more than was asked.
 */
export function localZoteroCollection(
  settings: Pick<IProjectBibliographyCollectionStore, "getCollection">,
  projectId: () => string | null | undefined,
): () => Promise<string | undefined> {
  return async () => {
    const id = projectId();
    if (!id) return undefined;
    try {
      return await settings.getCollection(id);
    } catch (err) {
      logToApp({
        level: "warn",
        source: "zotero",
        message: "Could not read the project's Zotero collection; importing the whole library",
        detail: `${id}: ${describeRejection(err)}`,
      });
      return undefined;
    }
  };
}
