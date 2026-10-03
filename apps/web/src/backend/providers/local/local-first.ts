"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BackendConfig } from "@/backend/config";
import { secretsStoreFor } from "@/backend/providers/secrets-store";
import { SupabaseAuthService } from "@/features/auth/infrastructure/supabase-auth";
import { SupabaseSettingsRepository } from "@/features/settings/infrastructure/supabase-settings-repository";
import { notifyWorkspaceChange } from "@/lib/workspace-changes";
import { wireStorage } from "@/storage/wire-storage";
import { createSupabaseClient } from "../supabase/client";
import { watchWrites } from "../supabase/watch-writes";
import type { BackendParts } from "../supabase/wire-supabase-backend";
import { createLocalClient, type LocalQuery } from "./pglite-client";
import type { LocalFirstAccount } from "./local-first-marker";
import { keepFlushing, LocalFirstBlobStore } from "./local-first-blob-store";
import { LocalSessionProvider } from "./local-identity";
import { LocalRunner } from "./local-runner";

/**
 * Local-first: a signed-in desktop works on its own database and syncs it.
 *
 * The tables that sync are read and written on this computer, so every screen
 * that shows them keeps working with no network and no session. Everything
 * else — sign-in, sharing, comments, settings — still talks to the server,
 * because the server is where those live. Files are kept here first and sent
 * on in the background: see `LocalFirstBlobStore`.
 *
 * Which account the device belongs to is remembered here, not read from the
 * session. A session can lapse; the work on this computer does not stop being
 * that account's work when it does. The marker is set once the device has been
 * adopted and has its first download, and cleared by a deliberate sign-out.
 */

/** The tables the change feed carries: see `0118_sync_change_feed.sql`, `0120` and `0138`. */
export const SYNCED_TABLES: ReadonlySet<string> = new Set([
  "projects",
  "papers",
  "tags",
  "paper_field_defs",
  "paper_field_values",
  "paper_relations",
  "reading_lists",
  "reading_list_items",
  "log_entries",
  "milestones",
  "experiments",
  "report_sections",
  "reader_annotations",
  "annotation_pins",
  "library_pins",
  "vault_pages",
  "screening_decisions",
  "paper_tags",
]);

/**
 * Metric reads that must see both ends: the desktop SDK API writes points to the
 * local database and the hosted SDK route to the server, and metrics do not sync.
 */
const BOTH_END_RPCS: ReadonlySet<string> = new Set(["metric_history", "latest_metric_activity"]);

type RpcReply = { data: unknown; error: unknown };

/** Rows from both ends; one end failing leaves the other's answer standing. */
async function bothEnds(
  local: SupabaseClient,
  server: SupabaseClient,
  fn: string,
  args?: Record<string, unknown>,
): Promise<RpcReply> {
  const [here, there] = (await Promise.all([local.rpc(fn, args), server.rpc(fn, args)])) as RpcReply[];
  if (here!.error && there!.error) return there!;
  const rows = (r: RpcReply) => (!r.error && Array.isArray(r.data) ? r.data : []);
  // A run's history lives on one end; preferring local keeps the budget-reduced
  // series intact instead of interleaving two reductions.
  if (fn === "metric_history") {
    const mine = rows(here!);
    return { data: mine.length ? mine : rows(there!), error: null };
  }
  return { data: [...rows(here!), ...rows(there!)], error: null };
}

/**
 * One client with two ends: synced tables go to the local database, the rest
 * of the client — tables that do not sync, RPCs, auth, storage, realtime — to
 * the server.
 */
export function routedClient(
  local: SupabaseClient,
  server: SupabaseClient,
  synced: ReadonlySet<string> = SYNCED_TABLES,
): SupabaseClient {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (table: string) => (synced.has(table) ? local.from(table) : target.from(table));
      }
      if (prop === "rpc") {
        return (fn: string, args?: Record<string, unknown>) =>
          BOTH_END_RPCS.has(fn) ? bothEnds(local, target, fn, args) : target.rpc(fn, args);
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export function localFirstParts(
  config: BackendConfig,
  account: LocalFirstAccount,
  query: LocalQuery = defaultQuery(),
): BackendParts {
  const server = createSupabaseClient(config.supabaseUrl ?? "", config.supabaseAnonKey ?? "", config.dataUrl);
  const local = createLocalClient(query) as unknown as SupabaseClient;
  const db = watchWrites(routedClient(local, server), notifyWorkspaceChange);
  // The account, not the session: a lapsed session must not turn every
  // repository's `requireUserId()` into a throw.
  const session = new LocalSessionProvider(account.id);
  const blobStore = new LocalFirstBlobStore(query, wireStorage({ supabaseDb: server }));
  keepFlushing(blobStore);
  return {
    db,
    session,
    auth: new SupabaseAuthService(server),
    settingsRepository: new SupabaseSettingsRepository(db, session, secretsStoreFor(server)),
    blobStore,
  };
}

function defaultQuery(): LocalQuery {
  const runner = new LocalRunner();
  return (sql, params) => runner.query(sql, params as never[]);
}
