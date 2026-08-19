import type {
  ICurrentUserProvider,
  IShareRepository,
  NewShareInput,
  Share,
  ShareableType,
} from "@weaveforge/core";
import type { PgRunner } from "../pg-runner";
import {
  type ShareRow,
  toDomain,
} from "@/features/sharing/infrastructure/share-rows";

export class PostgresShareRepository implements IShareRepository {
  constructor(
    private readonly pg: PgRunner,
    private readonly session: ICurrentUserProvider,
  ) {}

  async grant(input: NewShareInput): Promise<Share> {
    if (input.resourceId === null) {
      await this.pg.exec(
        `delete from shares
         where recipient_id = $1 and resource_type = $2 and resource_id is null`,
        [input.recipientId, input.resourceType],
      );
    } else {
      await this.pg.exec(
        `delete from shares
         where recipient_id = $1 and resource_type = $2 and resource_id = $3`,
        [input.recipientId, input.resourceType, input.resourceId],
      );
    }

    const row = await this.pg.queryOne<ShareRow>(
      `insert into shares (recipient_id, resource_type, resource_id, access)
       values ($1, $2, $3, $4) returning *`,
      [input.recipientId, input.resourceType, input.resourceId, input.access ?? "comment"],
    );
    if (!row) throw new Error("Failed to create share.");
    return toDomain(row);
  }

  async revoke(id: string): Promise<void> {
    await this.pg.exec("delete from shares where id = $1", [id]);
  }

  async listForResource(
    resourceType: ShareableType,
    resourceId: string | null,
  ): Promise<Share[]> {
    const rows =
      resourceId === null
        ? await this.pg.query<ShareRow>(
            "select * from shares where resource_type = $1 and resource_id is null",
            [resourceType],
          )
        : await this.pg.query<ShareRow>(
            "select * from shares where resource_type = $1 and resource_id = $2",
            [resourceType, resourceId],
          );
    return rows.map(toDomain);
  }

  async listSharedWithMe(resourceType?: ShareableType): Promise<Share[]> {
    const uid = await this.session.getCurrentUserId();
    if (!uid) return [];
    const rows = resourceType
      ? await this.pg.query<ShareRow>(
          "select * from shares where recipient_id = $1 and resource_type = $2 order by created_at desc",
          [uid, resourceType],
        )
      : await this.pg.query<ShareRow>(
          "select * from shares where recipient_id = $1 order by created_at desc",
          [uid],
        );
    return rows.map(toDomain);
  }
}

