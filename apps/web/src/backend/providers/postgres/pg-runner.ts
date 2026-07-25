import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { ICurrentUserProvider } from "@thesis/core";

const JWT_SUB_KEY = "request.jwt.claim.sub";

/** Run queries with RLS context (auth.uid()) from the signed-in user. */
export async function withPgUser<T>(
  pool: Pool,
  userId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (userId) {
      await client.query(`SELECT set_config($1, $2, true)`, [JWT_SUB_KEY, userId]);
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export class PgRunner {
  constructor(
    private readonly pool: Pool,
    private readonly session: ICurrentUserProvider,
  ) {}

  async run<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const uid = await this.session.getCurrentUserId();
    return withPgUser(this.pool, uid, fn);
  }

  async query<T extends QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return this.run(async (client) => {
      const { rows } = await client.query<T>(sql, params);
      return rows;
    });
  }

  async queryOne<T extends QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    await this.run(async (client) => {
      await client.query(sql, params);
    });
  }
}
