import type { Install097OldUserPort } from "../application/install-097-guard";
import { LEGACY_PERSONAL_TABLES, type LegacyTable } from "../application/install-097-legacy-tables";

/** countRows answers this when 0165 has archived the table: the count is unknown, not zero. */
export const TABLE_ARCHIVED = "TABLE_ARCHIVED";
export type TableCount = number | typeof TABLE_ARCHIVED;

/** The reads the web port needs. Supabase-backed in the app; faked in tests. */
export interface Install097Reads {
  /** `profiles.exported_097_at` for this user; null when unset or the column is missing. Throws on any other error. */
  exportedAt(userId: string): Promise<string | null>;
  /** Rows of one legacy table owned by this user, or TABLE_ARCHIVED when the table is gone. Throws on any other error. */
  countRows(table: LegacyTable, userId: string): Promise<TableCount>;
  /** SECURITY DEFINER rpc legacy_rows_pending_097: true when the archived tables still hold this user's rows. Throws when the rpc is missing. */
  legacyRowsPending(): Promise<boolean>;
}

type Probe = { table: string; result: TableCount } | { table: string; failed: true };

/**
 * The web reader. The mark is read once per check. A set mark means the export is verified, so
 * no table is counted. Without a mark, any row a user owns in a legacy table makes the account an
 * old user. Tables are probed in parallel and the check stops at the first non-empty table; a table
 * that 0165 archived is answered by the rpc, and a failed probe fails closed.
 */
export function createWebOldUserPort(reads: Install097Reads, userId: string): Install097OldUserPort {
  let mark: Promise<boolean> | undefined;
  const marked = () => (mark ??= reads.exportedAt(userId).then((at) => at !== null));
  return {
    ownRunVerified: () => marked(),
    async hasLegacyRows() {
      if (await marked()) return false;
      const pending = new Map<number, Promise<{ index: number; probe: Probe }>>();
      LEGACY_PERSONAL_TABLES.forEach((table, index) => {
        pending.set(
          index,
          reads.countRows(table, userId).then(
            (result): { index: number; probe: Probe } => ({ index, probe: { table: table.table, result } }),
            (): { index: number; probe: Probe } => ({ index, probe: { table: table.table, failed: true } }),
          ),
        );
      });
      let archived = false;
      let failed = false;
      while (pending.size > 0) {
        const { index, probe } = await Promise.race(pending.values());
        pending.delete(index);
        if ("failed" in probe) {
          failed = true;
          continue;
        }
        const { result } = probe;
        if (result === TABLE_ARCHIVED) archived = true;
        else if (typeof result !== "number") failed = true;
        else if (result > 0) return true;
      }
      if (failed) throw new Error("legacy row check failed");
      if (archived) return reads.legacyRowsPending();
      return false;
    },
  };
}
