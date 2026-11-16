import {
  PostgrestSettingsRepository,
  type Secrets,
  type SecretsStore,
} from "@/features/settings/infrastructure/parts";
import { desktop, type DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { notifyWorkspaceChange } from "@/lib/parts";
import { readyCore } from "@/lib/rust-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_USER_ID } from "@weaveforge/core";
import { watchWrites } from "../postgrest/watch-writes";
import type { BackendParts } from "../postgrest/wire-postgrest-backend";
import { LocalBlobStore, localFiles } from "./parts-1";
import { deviceUserId, LocalAuthService, LocalSessionProvider } from "./local-identity";
import { createLocalClient, type LocalQuery } from "./pglite-client";

// --- local-runner ---
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

export type LocalParam = string | number | boolean | null | Uint8Array;

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

/** Straight to the shell: the default query every local backend part runs. The identity is applied on the far side. */
export function localRunnerQuery(bridge: DesktopBridge | null = desktop()): LocalQuery {
  const runner = new LocalRunner(bridge);
  return (sql, params) => runner.query(sql, params as LocalParam[]);
}

// --- device-secrets-store ---
/**
 * Integration credentials kept on the machine that holds the database.
 *
 * For a deployment with no server that can answer `/api/settings/credentials`:
 * a static export holds `src/app/api/` aside (`apps/shell/scripts/build-web.mjs`),
 * so the route is not in the bundle at all and a fetch for it reaches the
 * `app://` file handler instead. What came back was a 404 with an empty body,
 * which the route store could only turn into "Failed to save integration
 * credentials." — and because `save()` writes the secrets before the row, no
 * setting was saved either.
 *
 * The row is this *device's*, not the account's: one per machine, under
 * `LOCAL_USER_ID`, the same identity the shell applies when it opens the
 * database. It is protected by the file permissions on the app's data directory
 * and nothing else, which is what Settings tells the reader and what
 * `docs/using/desktop.md` promises. So a credential entered here does not follow
 * the account to another machine — the account's own copy is still the one the
 * website writes, through the route.
 *
 * This is deliberately not "the local-mode store". The desktop shell applies
 * `db/migrations-local` on every launch, signed in or not, so the table
 * exists either way — and the question that picks this store is whether the
 * deployment has routes of its own, never which mode a window is in.
 */
export class DeviceSecretsStore implements SecretsStore {
  constructor(private readonly run: LocalQuery = localRunnerQuery()) {}

  async load(): Promise<Secrets> {
    const rows = (await this.run(readyCore().localSecretsLoadSql(), [LOCAL_USER_ID])) as {
      secrets: Secrets | string | null;
    }[];
    const stored = rows[0]?.secrets;
    const text =
      stored === undefined || stored === null
        ? undefined
        : typeof stored === "string"
          ? stored
          : JSON.stringify(stored);
    return JSON.parse(readyCore().localSecretsJsonText(text)) as Secrets;
  }

  async save(secrets: Secrets): Promise<void> {
    await this.run(readyCore().localSecretsSaveSql(), [LOCAL_USER_ID, JSON.stringify(secrets)]);
  }
}

// --- wire-local-backend ---
/**
 * The three things that make the app run on this computer alone.
 *
 * The repositories are untouched: they get a client with the same shape, an
 * identity that answers without a session, and a blob store that keeps bytes
 * in the local database. Writes are wrapped the same way as the PostgREST
 * client's, so the folder mirror, the local HTTP surface and the MCP server
 * hear about a local edit exactly as they hear about a synced one.
 *
 * The settings repository is the account one with the credentials store swapped,
 * not a subclass: the difference was never the mode, only where secrets can
 * live. See `DeviceSecretsStore`.
 */
export function localBackendParts(query: LocalQuery = localRunnerQuery()): BackendParts {
  const db = watchWrites(createLocalClient(query) as unknown as SupabaseClient, notifyWorkspaceChange);
  // The shell may run this database as the account the device was adopted by.
  const session = new LocalSessionProvider(() => deviceUserId(query));
  return {
    db,
    session,
    settingsRepository: new PostgrestSettingsRepository(db, session, new DeviceSecretsStore(query)),
    // Offline copies never show server notices.
    releaseNotices: { unseen: async () => null },
    auth: new LocalAuthService(),
    blobStore: new LocalBlobStore(query, localFiles(desktop())),
  };
}
