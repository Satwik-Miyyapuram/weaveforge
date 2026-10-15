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
 * The wrapper is deliberately narrow. It reports the table name after a write
 * resolves without error, and does nothing else: no batching, no payloads, no
 * opinion about what the listener should do. Reads are untouched, so the
 * common path pays a property lookup and nothing more.
 */

/** The builder methods that mean a write. Everything else is a read. */
const MUTATIONS = new Set(["insert", "update", "upsert", "delete"]);

export type WriteListener = (table: string) => void;

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
      if (prop !== "from" || typeof value !== "function") return value;
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
