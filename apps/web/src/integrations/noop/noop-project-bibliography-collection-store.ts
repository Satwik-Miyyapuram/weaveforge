import type { IProjectBibliographyCollectionStore } from "@weaveforge/core";

/** No per-project bibliography collection when bibliography integration is disabled. */
export class NoopProjectBibliographyCollectionStore implements IProjectBibliographyCollectionStore {
  async getCollection(_projectId: string): Promise<string | undefined> {
    return undefined;
  }

  async setCollection(_projectId: string, _collectionKey: string | null): Promise<void> {
    /* no-op */
  }
}
