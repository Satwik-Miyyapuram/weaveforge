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
