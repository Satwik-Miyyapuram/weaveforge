import type { IMilestoneManager, IMilestoneRepository, Milestone } from "@weaveforge/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { projectUserCtx, rustRepository } from "@/backend/providers/postgrest/rust-repository";
import type { ProjectContext } from "@/lib/parts-2";

/**
 * The `milestones` repository through the Rust step engine
 * (`crates/wf-core/src/repos/milestones.rs`), scoped to the open project.
 *
 * Rust sends unset optional fields as `null`; the domain type wants them absent,
 * so reads drop the nulls, as the stored JSON had them.
 */
export function rustMilestoneRepository(
  db: SupabaseClient,
  project: ProjectContext,
): IMilestoneRepository & IMilestoneManager {
  const repo = rustRepository<IMilestoneRepository & IMilestoneManager>(
    db,
    "milestones",
    ["getById", "list", "save", "delete", "add", "setStatus", "update", "remove"],
    projectUserCtx(project),
  );
  return {
    ...repo,
    getById: async (id) => {
      const m = await repo.getById(id);
      return m && withoutNullFields(m);
    },
    list: async (filter) => (await repo.list(filter)).map(withoutNullFields),
  };
}

/** The milestone with its null fields, and those of its dependencies and compute needs, left out. */
function withoutNullFields(m: Milestone): Milestone {
  const out = withoutNulls(m);
  return { ...out, dependencies: m.dependencies.map(withoutNulls), compute: m.compute.map(withoutNulls) };
}

/** The object with its null fields left out. */
function withoutNulls<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as T;
}
