import type { LocalQuery } from "./pglite-client";
import { LocalRunner } from "./local-runner";

/**
 * A `LocalQuery` over the desktop app's local database: straight to the shell.
 * The identity is applied on the far side, not here.
 */
export function localQuery(runner: LocalRunner = new LocalRunner()): LocalQuery {
  return (sql, params) => runner.query(sql, params as never[]);
}
