import type { Install097OldUserPort } from "../application/install-097-guard";
import { LEGACY_PERSONAL_TABLES } from "../application/install-097-legacy-tables";

/** The two reads the web port needs. Supabase-backed in the app; faked in tests. */
export interface Install097Reads {
  /** `profiles.exported_097_at` for this user; null when unset or the column is missing. Throws on any other error. */
  exportedAt(userId: string): Promise<string | null>;
  /** Row count of one table for the signed-in user. Throws on error. */
  countRows(table: string): Promise<number>;
}

/**
 * The web reader. The mark is read once per check. A set mark means the export is verified, so
 * no table is counted. Without a mark, any row in a legacy table makes the account an old user.
 */
export function createWebOldUserPort(reads: Install097Reads, userId: string): Install097OldUserPort {
  let mark: Promise<boolean> | undefined;
  const marked = () => (mark ??= reads.exportedAt(userId).then((at) => at !== null));
  return {
    ownRunVerified: () => marked(),
    async hasLegacyRows() {
      if (await marked()) return false;
      for (const table of LEGACY_PERSONAL_TABLES) {
        const count = await reads.countRows(table);
        if (typeof count !== "number") throw new Error(`count ${table} is not a number`);
        if (count > 0) return true;
      }
      return false;
    },
  };
}
