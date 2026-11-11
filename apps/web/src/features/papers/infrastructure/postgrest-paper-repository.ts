import { projectUserCtx, rustRepository } from "@/backend/providers/postgrest/rust-repository";
import type { ProjectContext } from "@/lib/parts-2";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EntityStamp, IPaperRepository, Paper } from "@weaveforge/core";

/**
 * The paper repository, plus the stamp and by-id reads the cache and sharing use.
 *
 * Persistence against `papers` runs through the Rust step engine
 * (`crates/wf-core/src/repos/papers.rs`): Rust plans every query, scopes it to the
 * open project, normalizes DOIs and maps the rows. No business rules live here.
 */
export type RustPaperRepository = IPaperRepository & {
  listStamps(): Promise<EntityStamp[]>;
  listByIds(ids: readonly string[]): Promise<Paper[]>;
};

/** `papers`, scoped to the open project. */
export function rustPaperRepository(db: SupabaseClient, project: ProjectContext): RustPaperRepository {
  return rustRepository<RustPaperRepository>(
    db,
    "papers",
    [
      "getById",
      "listStamps",
      "listByIds",
      "list",
      "listSummaries",
      "save",
      "setTags",
      "replaceSummary",
      "findByTitleKey",
      "delete",
      "findByArxivId",
      "findByDoi",
      "findIdentityByArxivId",
      "findIdentityByDoi",
    ],
    projectUserCtx(project),
  );
}
