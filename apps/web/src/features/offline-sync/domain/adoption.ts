import type { SqlRunner } from "./outbox";
import { SyncStateStore } from "./sync-state";

/**
 * Turning sync on for the first time: this device's work becomes an account's.
 *
 * It happens once in a device's life. After it, both sides share a server
 * history and every write goes through the normal machinery — versioned
 * updates, tombstones, the watermark. Before it, there is no shared history at
 * all, which is why the collision rule below is a rename rather than a merge.
 */

export interface AdoptionRequest {
  accountId: string;
  /** Names the account already holds, so a collision can be spotted. */
  remoteProjectNames: readonly string[];
  /**
   * How the reader knows this machine. It goes in the suffix, because "which
   * laptop was this?" is the question they can actually answer.
   */
  deviceLabel: string;
}

export interface AdoptionResult {
  claimed: number;
  queued: number;
  renamed: readonly { id: string; from: string; to: string }[];
}

export interface OfflineChangeSummary {
  totalCount: number;
  tables: Record<string, number>;
  projects: Array<{ id: string; name: string }>;
  collidingProjects: Array<{ id: string; localName: string; willRenameTo: string }>;
}

export class AlreadyAdoptedError extends Error {
  constructor(readonly accountId: string) {
    super("This device already syncs with an account.");
    this.name = "AlreadyAdoptedError";
  }
}

interface ProjectRow {
  id: string;
  name: string;
}

export class Adoption {
  private readonly state: SyncStateStore;

  constructor(
    private readonly sql: SqlRunner,
    private readonly localUserId: string,
  ) {
    this.state = new SyncStateStore(sql);
  }

  /**
   * Preview offline work waiting to be adopted by an account.
   */
  async inspect(
    remoteProjectNames: readonly string[] = [],
    deviceLabel = "this device",
  ): Promise<OfflineChangeSummary> {
    const local = await this.sql.query<ProjectRow>(
      "select id, name from projects where user_id = $1 and deleted_at is null order by name",
      [this.localUserId],
    ).catch(() => []);

    const taken = new Set(remoteProjectNames);
    const collidingProjects: Array<{ id: string; localName: string; willRenameTo: string }> = [];
    for (const p of local) {
      if (taken.has(p.name)) {
        collidingProjects.push({
          id: p.id,
          localName: p.name,
          willRenameTo: uniqueName(p.name, deviceLabel, taken),
        });
      }
    }

    const tables = await this.sql.query<{ table_name: string }>(
      `select s.table_name from sync_tables s
       where exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = s.table_name
                        and c.column_name = 'user_id')
       order by s.table_name`,
    ).catch(() => []);

    const tableCounts: Record<string, number> = {};
    let totalCount = 0;

    for (const { table_name } of tables) {
      const row = await this.sql.queryOne<{ n: number }>(
        `select count(*)::int as n from "${table_name.replace(/"/g, '""')}" where user_id = $1`,
        [this.localUserId],
      ).catch(() => null);
      const count = Number(row?.n ?? 0);
      if (count > 0) {
        tableCounts[table_name] = count;
        totalCount += count;
      }
    }

    return {
      totalCount,
      tables: tableCounts,
      projects: local,
      collidingProjects,
    };
  }

  async run(request: AdoptionRequest): Promise<AdoptionResult> {
    const state = await this.state.read();
    // Adopting twice would take rows from the first account and hand them to
    // the second — silently, and with no way back.
    if (state.accountId) throw new AlreadyAdoptedError(state.accountId);

    const renamed = await this.rename(request.remoteProjectNames, request.deviceLabel);
    const claimed = await this.claim(request.accountId);
    const queued = await this.backfill(request.accountId);
    await this.state.adopt(request.accountId);
    return { claimed, queued, renamed };
  }

  /**
   * Two projects that share a name may be the same work in two states or two
   * unrelated things, and nothing here can tell which. Fusing them interleaves
   * two sets of notes unrecoverably; two projects side by side is a tidy-up the
   * reader can do knowingly. So: keep both, and say which machine this one
   * came from.
   */
  private async rename(
    remoteNames: readonly string[],
    deviceLabel: string,
  ): Promise<AdoptionResult["renamed"]> {
    const taken = new Set(remoteNames);
    if (taken.size === 0) return [];
    const local = await this.sql.query<ProjectRow>(
      "select id, name from projects where user_id = $1 and deleted_at is null order by name",
      [this.localUserId],
    );
    const renamed: { id: string; from: string; to: string }[] = [];
    for (const project of local) {
      if (!taken.has(project.name)) continue;
      const to = uniqueName(project.name, deviceLabel, taken);
      taken.add(to);
      await this.sql.exec("update projects set name = $1 where id = $2", [to, project.id]);
      renamed.push({ id: project.id, from: project.name, to });
    }
    return renamed;
  }

  private async claim(accountId: string): Promise<number> {
    const row = await this.sql.queryOne<{ sync_claim: number }>(
      "select sync_claim($1, $2) as sync_claim",
      [accountId, this.localUserId],
    );
    return Number(row?.sync_claim ?? 0);
  }

  private async backfill(accountId: string): Promise<number> {
    const row = await this.sql.queryOne<{ sync_backfill: number }>(
      "select sync_backfill($1) as sync_backfill",
      [accountId],
    );
    return Number(row?.sync_backfill ?? 0);
  }
}

/**
 * `Thesis` → `Thesis (desktop)`. If that is taken too — the reader adopted a
 * third machine with the same label — count from there rather than overwrite.
 */
function uniqueName(name: string, deviceLabel: string, taken: ReadonlySet<string>): string {
  const base = `${name} (${deviceLabel})`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${name} (${deviceLabel} ${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}
