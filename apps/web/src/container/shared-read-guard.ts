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

interface DbLike {
  from(table: string): unknown;
}

/**
 * Wraps the client the shared reader runs on in files mode (0.9.8): a select on a shared table
 * passes, and a write, an rpc, schema() or any other table throws before a request is made.
 * Only from, rpc and schema are checked; other members (auth and the like) pass through.
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
      if (key === "rpc" || key === "schema") {
        return () => {
          throw new Error(`${String(key)} not allowed for the shared read`);
        };
      }
      return Reflect.get(target, key, receiver);
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
