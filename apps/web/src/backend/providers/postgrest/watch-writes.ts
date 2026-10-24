import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Notice when anything writes, without asking every writer to say so.
 *
 * Three things now want to know that the workspace changed -- the folder
 * mirror, and later the local HTTP surface and the MCP server -- and the app
 * had nowhere to tell them from. There is no mutation bus, and the nearest
 * thing to one, the offline outbox, only runs when offline sync is switched
 * on: hanging the mirror there would give a folder that updates itself for
 * some users and not others, which is worse than one that never does, because
 * the difference is invisible.
 *
 * What every write does share is this client. Roughly forty repositories reach
 * for `db.from(table)` and none of them reach past it, so wrapping it once
 * covers all of them and leaves every call site alone. The alternative -- a
 * `notifyChanged()` at each write -- is forty edits that must be repeated by
 * every repository written afterwards, and the failure mode of forgetting one
 * is a folder that is silently stale for exactly one kind of edit.
 *
 * Database functions that write are the one path around `from()`; they are
 * listed in `RPC_WRITES` and reported the same way.
 *
 * The wrapper is deliberately narrow. It reports the table name after a write
 * resolves without error, and does nothing else: no batching, no payloads, no
 * opinion about what the listener should do. Reads are untouched, so the
 * common path pays a property lookup and nothing more.
 */

/** The builder methods that mean a write. Everything else is a read. */
const MUTATIONS = new Set(["insert", "update", "upsert", "delete"]);

export type WriteListener = (table: string) => void;

/**
 * Every RPC the app calls, mapped to the workspace table it writes, or `null`
 * when it writes nothing a workspace listener cares about.
 *
 * A database function writes without passing through `from()`, so the proxy
 * cannot see it and has to be told. `null` covers reads, access bookkeeping,
 * account and organisation calls, and server-only token lookups. A test scans
 * the source and fails on any RPC missing here, so a new one cannot default to
 * "read" by being forgotten.
 */
export const RPC_WRITES: Readonly<Record<string, string | null>> = {
  set_comment_resolved: "comments",
  redeem_share_link: "shares",
  compact_crdt_log: "crdt_updates",

  api_token_scopes: null,
  claim_ai_mcp_relay_requests: null,
  complete_org_setup: null,
  create_organization_atomic: null,
  delete_user_account_data: null,
  ensure_user_provisioned: null,
  join_organization_atomic: null,
  latest_metric_activity: null,
  leave_org: null,
  metric_history: null,
  record_blob_access: null,
  record_blob_access_many: null,
  resolve_api_token: null,
  resolve_mcp_relay_token: null,
  resolve_plan_feed_token: null,
  resolve_share_link: null,
  shared_to_user: null,
  switch_active_org: null,
  sync_changes: null,
};

/**
 * Wrap a client so `onWrite(table)` fires after each successful write.
 *
 * A failed write is not a change: reporting one would have the mirror re-read
 * the whole workspace to discover that nothing happened.
 */
export function watchWrites<T extends SupabaseClient>(db: T, onWrite: WriteListener): T {
  return new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (prop === "rpc") {
        return (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => unknown).apply(target, args);
          const fn = args[0];
          const table = typeof fn === "string" && Object.hasOwn(RPC_WRITES, fn) ? RPC_WRITES[fn] : null;
          return table ? watchBuilder(result, table, onWrite, true) : result;
        };
      }
      if (prop !== "from") return value;
      return (...args: unknown[]) => {
        const builder = (value as (...a: unknown[]) => unknown).apply(target, args);
        const table = typeof args[0] === "string" ? args[0] : "";
        return watchBuilder(builder, table, onWrite, false);
      };
    },
  }) as T;
}

/**
 * Follow one query as it is built.
 *
 * `armed` is whether a mutation has been called yet. Until it has, this only
 * watches for one; afterwards it stays attached through the rest of the chain
 * -- `.eq()`, `.select()`, and the like all return further builders -- so that
 * whichever object is finally awaited is the one carrying the report.
 */
function watchBuilder(builder: unknown, table: string, onWrite: WriteListener, armed: boolean): unknown {
  if (typeof builder !== "object" || builder === null) return builder;

  return new Proxy(builder as object, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // The awaited result. Only an armed chain reports, and only on success:
      // PostgREST answers errors in the payload rather than by rejecting, so
      // the check is on `error`, not on whether this settled.
      if (armed && prop === "then" && typeof value === "function") {
        return (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
          (value as (...a: unknown[]) => unknown).call(
            target,
            (result: unknown) => {
              if (!(result as { error?: unknown } | null)?.error) report(table, onWrite);
              return onFulfilled ? onFulfilled(result) : result;
            },
            onRejected,
          );
      }

      if (typeof value !== "function") return value;

      const mutating = armed || (typeof prop === "string" && MUTATIONS.has(prop));
      return (...args: unknown[]) =>
        watchBuilder((value as (...a: unknown[]) => unknown).apply(target, args), table, onWrite, mutating);
    },
  });
}

/**
 * A listener must never be able to fail a write that already succeeded.
 *
 * The row is in the database either way, and turning a bookkeeping error into
 * a failed save would be the one outcome worth avoiding here.
 */
function report(table: string, onWrite: WriteListener): void {
  try {
    onWrite(table);
  } catch {
    // Nothing to do with it, and nowhere useful to put it.
  }
}
