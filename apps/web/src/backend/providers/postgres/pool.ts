import pg from "pg";

let pool: pg.Pool | null = null;

/** Singleton pg pool for DATABASE_URL (server-side only). */
export function getPgPool(databaseUrl: string): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  }
  return pool;
}

