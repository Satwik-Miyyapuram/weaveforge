import type { Comment, ICommentRepository, NewCommentInput } from "@thesis/core";
import type { PgRunner } from "../pg-runner";

interface CommentRow {
  id: string;
  author_id: string;
  resource_type: string;
  resource_id: string;
  body: string;
  created_at: string;
}

export class PostgresCommentRepository implements ICommentRepository {
  constructor(private readonly pg: PgRunner) {}

  async list(resourceType: string, resourceId: string): Promise<Comment[]> {
    const rows = await this.pg.query<CommentRow>(
      `select * from comments
       where resource_type = $1 and resource_id = $2
       order by created_at asc`,
      [resourceType, resourceId],
    );
    return rows.map(toDomain);
  }

  async add(input: NewCommentInput): Promise<Comment> {
    const row = await this.pg.queryOne<CommentRow>(
      `insert into comments (resource_type, resource_id, body)
       values ($1, $2, $3) returning *`,
      [input.resourceType, input.resourceId, input.body],
    );
    if (!row) throw new Error("Failed to create comment.");
    return toDomain(row);
  }

  async remove(id: string): Promise<void> {
    await this.pg.exec("delete from comments where id = $1", [id]);
  }

  async save(comment: Comment): Promise<Comment> {
    const row = await this.pg.queryOne<CommentRow>(
      `insert into comments (id, author_id, resource_type, resource_id, body, created_at)
       values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()))
       on conflict (id) do update set
         body = excluded.body,
         resource_type = excluded.resource_type,
         resource_id = excluded.resource_id
       returning *`,
      [
        comment.id,
        comment.authorId || null,
        comment.resourceType,
        comment.resourceId,
        comment.body,
        comment.createdAt || null,
      ],
    );
    if (!row) throw new Error("Failed to save comment.");
    return toDomain(row);
  }

  async listAll(): Promise<Comment[]> {
    const rows = await this.pg.query<CommentRow>(
      `select * from comments order by created_at asc`,
    );
    return rows.map(toDomain);
  }
}

function toDomain(r: CommentRow): Comment {
  return {
    id: r.id,
    authorId: r.author_id,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    body: r.body,
    createdAt: r.created_at,
  };
}
