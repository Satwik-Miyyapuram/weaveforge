/**
 * Apply an ordered set of SQL migrations to a database, skipping the ones it
 * already ran. Database-agnostic: the caller passes in what can run SQL.
 *
 * No import of PGlite, or of node's fs: the caller passes in something that can
 * run SQL and something that can list migrations, so this file stays usable
 * from a browser bundle and from an Electron main process alike.
 */

import { errorMessage } from "../shared/errors.js";

/** One migration, named the way the file is named so an error can say which. */
export interface Migration {
  readonly name: string;
  readonly sql: string;
}

/**
 * Apply migrations in the given order, skipping any this database already ran.
 *
 * The order is the caller's, and it is applied as given. Sorting here would be
 * a second opinion about it, and it would be wrong for a caller that draws from
 * more than one directory — where the order between directories is a decision,
 * not something a name comparison can recover.
 *
 * `applied` is asked once and answered from whatever bookkeeping the caller
 * keeps — a table on disk for the desktop app, an empty set for a database
 * built fresh per test process. A migration that fails names itself, because
 * the alternative is a stack trace from deep inside Postgres with no hint of
 * which of a hundred files produced it.
 *
 * `exec` is told the migration's name too, so a caller that keeps a ledger can
 * write it in the same transaction as the migration itself.
 */
export async function applyMigrations(
  migrations: readonly Migration[],
  exec: (sql: string, name: string) => Promise<unknown>,
  options: { applied?: ReadonlySet<string>; onApplied?: (name: string) => Promise<void> } = {},
): Promise<string[]> {
  const applied = options.applied ?? new Set<string>();
  const ran: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    try {
      await exec(migration.sql, migration.name);
    } catch (error) {
      const reason = errorMessage(error);
      throw new Error(`Migration ${migration.name} failed on a clean database: ${reason}`);
    }
    await options.onApplied?.(migration.name);
    ran.push(migration.name);
  }
  return ran;
}
