import { desktop, type DesktopBridge } from "@/lib/desktop/desktop-bridge";

/**
 * The local database, from the page's side.
 *
 * The same three verbs `PgRunner` offers — `query`, `queryOne`, `exec` — so a
 * repository written against one works against the other. What is missing is
 * `run`: there is no way to hold a transaction open across several statements
 * from here, and that is deliberate rather than unfinished. PGlite is a single
 * connection; a page that could open a transaction could hold the app's only
 * connection while it sits at a breakpoint, and nothing else would run.
 *
 * Statements that must be atomic therefore belong in one statement — a CTE, or
 * a function — which is a constraint worth having: it keeps the local database
 * and the server's PostgREST path able to run the same SQL.
 */

export type LocalParam = string | number | boolean | null;

/** The identity is not passed from here; see `local-db-host.ts` for why. */
export class LocalRunner {
  constructor(private readonly bridge: DesktopBridge | null = desktop()) {}

  private get shell(): DesktopBridge {
    if (!this.bridge) throw new Error("The local database is only available in the desktop app.");
    return this.bridge;
  }

  async query<T>(sql: string, params: LocalParam[] = []): Promise<T[]> {
    return (await this.shell.queryLocalDb(sql, params)) as T[];
  }

  async queryOne<T>(sql: string, params: LocalParam[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async exec(sql: string, params: LocalParam[] = []): Promise<void> {
    await this.query(sql, params);
  }
}
