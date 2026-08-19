import type {
  ILibraryPinRepository,
  LibraryPin,
  NewLibraryPinInput,
  ShareableType,
} from "@weaveforge/core";
import type { ICurrentUserProvider } from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import type { PgRunner } from "../pg-runner";
import {
  type PinRow,
  toDomain,
} from "@/features/library/infrastructure/library-pin-rows";

export class PostgresLibraryPinRepository implements ILibraryPinRepository {
  constructor(
    private readonly pg: PgRunner,
    private readonly ctx: ProjectContext,
    private readonly session: ICurrentUserProvider,
  ) {}

  private get projectId() {
    const id = this.ctx.projectId;
    if (!id) throw new Error("Select a project before pinning items.");
    return id;
  }

  async pin(input: NewLibraryPinInput): Promise<LibraryPin> {
    const userId = await this.session.requireUserId();
    const rows = await this.pg.query<PinRow>(
      `insert into library_pins (user_id, project_id, resource_type, resource_id, owner_id)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id, project_id, resource_type, resource_id)
       do update set owner_id = excluded.owner_id
       returning *`,
      [userId, this.projectId, input.resourceType, input.resourceId, input.ownerId],
    );
    return toDomain(rows[0]!);
  }

  async unpin(resourceType: ShareableType, resourceId: string): Promise<void> {
    await this.pg.query(
      `delete from library_pins
       where user_id = auth.uid()
         and project_id = $1
         and resource_type = $2
         and resource_id = $3`,
      [this.projectId, resourceType, resourceId],
    );
  }

  async listForProject(): Promise<LibraryPin[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    const rows = await this.pg.query<PinRow>(
      `select * from library_pins
       where user_id = auth.uid() and project_id = $1
       order by created_at desc`,
      [projectId],
    );
    return rows.map(toDomain);
  }

  async isPinned(resourceType: ShareableType, resourceId: string): Promise<boolean> {
    const projectId = this.ctx.projectId;
    if (!projectId) return false;
    const rows = await this.pg.query<{ n: number }>(
      `select count(*)::int as n from library_pins
       where user_id = auth.uid()
         and project_id = $1
         and resource_type = $2
         and resource_id = $3`,
      [projectId, resourceType, resourceId],
    );
    return (rows[0]?.n ?? 0) > 0;
  }
}

