import type { IProjectBibliographyCollectionStore } from "@thesis/core";
import type { PgRunner } from "../pg-runner";

interface CollectionRow {
  zotero_collection: string | null;
}

/** Per-project Zotero collection on external Postgres (`projects.zotero_collection`). */
export class PostgresProjectBibliographyCollectionStore implements IProjectBibliographyCollectionStore {
  constructor(private readonly pg: PgRunner) {}

  async getCollection(projectId: string): Promise<string | undefined> {
    const row = await this.pg.queryOne<CollectionRow>(
      "select zotero_collection from projects where id = $1",
      [projectId],
    );
    return row?.zotero_collection ?? undefined;
  }

  async setCollection(projectId: string, collection: string | null): Promise<void> {
    await this.pg.exec("update projects set zotero_collection = $1 where id = $2", [
      collection || null,
      projectId,
    ]);
  }
}
