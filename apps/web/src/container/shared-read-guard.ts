/**
 * The tables the shared-with-me read selects from: one per shareable type, as
 * `shared_table_source` names them (crates/wf-core/src/sharing.rs). They are an owner's
 * personal rows, so they are not on the org allowlist; only this read reaches them.
 */
export const SHARED_READ_TABLES = [
  "milestones",
  "experiments",
  "report_sections",
  "reading_lists",
  "papers",
  "vault_pages",
] as const;

const TABLES = new Set<string>(SHARED_READ_TABLES);
const WRITES = new Set(["insert", "update", "upsert", "delete"]);
/** Client members that hold their own request clients (Supabase storage, edge functions, realtime, raw PostgREST). */
const REQUEST_CLIENTS = new Set(["storage", "functions", "realtime", "rest"]);

interface DbLike {
  from(table: string): unknown;
}

/**
 * Wraps the client the shared reader runs on in files mode (0.9.8): a select on a shared table
 * passes, and a write, an rpc, schema() or any other table throws before a request is made.
 * storage, functions, realtime and rest throw on access, and every other method throws when called;
 * plain values (auth and the like), symbol-keyed members and the Object.prototype methods
 * (toString, constructor) pass through.
 * Row access is still the server's: RLS returns only the rows the grants allow.
 */
export function guardSharedReadDb<Db extends DbLike>(db: Db): Db {
  return new Proxy(db, {
    get(target, key, receiver) {
      if (key === "from") {
        return (table: string) => {
          if (!TABLES.has(table)) throw new Error(`Table not allowed for the shared read: ${table}`);
          return selectOnly(target.from(table) as object);
        };
      }
      if (typeof key === "string" && REQUEST_CLIENTS.has(key)) {
        throw new Error(`${key} not allowed for the shared read`);
      }
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value === "function" && typeof key === "string" && !(key in Object.prototype)) {
        return () => {
          throw new Error(`${key} not allowed for the shared read`);
        };
      }
      return value;
    },
  });
}

/** A query builder with writes refused; the builders its methods return (select, filters) are wrapped too. */
function selectOnly<B extends object>(builder: B): B {
  return new Proxy(builder, {
    get(target, key, receiver) {
      if (typeof key === "string" && WRITES.has(key)) {
        return () => {
          throw new Error(`Only a shared read is allowed: ${key}`);
        };
      }
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      // `then` runs the query on the raw builder: its internals call methods that return promises,
      // and a promise wrapped in a Proxy cannot be awaited.
      if (key === "then") return (value as (...a: unknown[]) => unknown).bind(target);
      return (...args: unknown[]) => {
        const next: unknown = (value as (...a: unknown[]) => unknown).apply(target, args);
        return next && typeof next === "object" && !(next instanceof Promise) ? selectOnly(next) : next;
      };
    },
  });
}
