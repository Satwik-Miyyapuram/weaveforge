import type { SupabaseClient } from "@supabase/supabase-js";
import type { ICurrentUserProvider } from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";

/**
 * The two things every project-scoped Supabase repository is built from: the
 * client and the project the user has selected. Nine repositories spelled out
 * the same constructor and the same `pid` getter, so it lives here now.
 */
export abstract class ProjectRepository {
  constructor(
    protected readonly db: SupabaseClient,
    protected readonly ctx: ProjectContext,
  ) {}

  /** The selected project id, unchecked — reads simply filter by it. */
  protected get pid() {
    return this.ctx.projectId;
  }

  /**
   * Apply the project filter, when a project is selected.
   *
   * Every read in every project-scoped repository has to remember this, and the
   * one that forgot it returned other projects' rows wherever RLS is not what
   * is standing in the way — a self-hosted Postgres, or the local backend.
   * Naming the rule makes it one line at the call site instead of a two-line
   * `if` that is easy to leave out, and it reads as "this query is scoped"
   * rather than as a filter that happens to be there.
   *
   * Writes are different: they go through `ProjectScopedSupabaseRepository`,
   * which refuses to run at all without a project.
   */
  protected scoped<Q>(query: Q): Q {
    const pid = this.ctx.projectId;
    if (!pid) return query;
    // Deliberately unconstrained, with one cast right here.
    //
    // `.eq()` does return the same builder, but expressing that as a constraint
    // on `Q` (`Q extends { eq(column: string, value: string): Q }`) makes the
    // compiler relate the whole Postgrest builder type to itself at every call
    // site, and it gives up with TS2589 — "type instantiation is excessively
    // deep". Leaving `Q` free keeps each caller's inferred row type intact and
    // confines the single cast to this method.
    const filterable = query as unknown as { eq(column: string, value: string): Q };
    return filterable.eq("project_id", pid);
  }
}

/**
 * The three things every project-scoped Supabase repository is built from, and
 * the one rule they all share: writing to a project-scoped table without a
 * project selected is a bug, and the message has to name what the user was
 * doing or it reads as a crash.
 *
 * Subclasses say what that was in `action` and get `projectId` for free.
 */
export abstract class ProjectScopedSupabaseRepository extends ProjectRepository {
  constructor(
    db: SupabaseClient,
    ctx: ProjectContext,
    protected readonly session: ICurrentUserProvider,
  ) {
    super(db, ctx);
  }

  /** Completes "Select a project before …" — e.g. `"pinning items"`. */
  protected abstract readonly action: string;

  protected get projectId(): string {
    const id = this.ctx.projectId;
    if (!id) throw new Error(`Select a project before ${this.action}.`);
    return id;
  }
}
