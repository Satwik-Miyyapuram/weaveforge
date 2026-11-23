import { RPC_WRITES } from "@/backend/providers/postgrest/watch-writes";
import { FILES_MODE_CRDT_TYPES } from "@/features/collab/infrastructure/files-mode-crdt-limit";
import { ORG_SERVER_BUCKETS, ORG_SERVER_READ_TABLES, ORG_SERVER_RPCS, ORG_SERVER_WRITE_TABLES } from "./org-server-allowlist";

const TABLES = new Set<string>(ORG_SERVER_READ_TABLES);
const RPCS = new Set<string>(ORG_SERVER_RPCS);

/** The part of the PostgREST client the guard checks. Every other member passes through unchanged. */
interface OrgDbLike {
  from(table: string): unknown;
  rpc(name: string, body?: unknown): unknown;
}

interface SchemaDbLike extends OrgDbLike {
  schema(name: string): unknown;
}

/**
 * Wraps the org server db so only allowlisted tables and rpcs are reachable. Personal data is
 * never sent to the server; a call outside the list throws before any request is made.
 * `schema()` hands back another client, so that client is guarded too.
 */
export function guardOrgDb<Db extends OrgDbLike>(db: Db): Db {
  return new Proxy(db, {
    get(target, key, receiver) {
      if (key === "from") {
        return (table: string) => {
          if (!TABLES.has(table)) throw new Error(`Table not allowed on the org server: ${table}`);
          return target.from(table);
        };
      }
      if (key === "rpc") {
        return (name: string, body?: unknown) => {
          if (!RPCS.has(name)) throw new Error(`Rpc not allowed on the org server: ${name}`);
          return target.rpc(name, body);
        };
      }
      if (key === "schema" && "schema" in target) {
        return (name: string) => guardOrgDb((target as unknown as SchemaDbLike).schema(name) as OrgDbLike);
      }
      return Reflect.get(target, key, receiver);
    },
  });
}

/** Thrown by readOnlyDb for a personal write: files mode, or a desktop not yet exported. */
export const READ_ONLY_MESSAGE = "read-only until export verified";

export class ReadOnlyError extends Error {
  constructor() {
    super(READ_ONLY_MESSAGE);
    this.name = "ReadOnlyError";
  }
}

const ORG_WRITE_TABLES: ReadonlySet<string> = new Set(ORG_SERVER_WRITE_TABLES);
const ORG_RPCS: ReadonlySet<string> = new Set(ORG_SERVER_RPCS);
const DB_WRITE_METHODS: ReadonlySet<string> = new Set(["insert", "update", "upsert", "delete"]);
const STORAGE_WRITE_METHODS: ReadonlySet<string> = new Set(["upload", "update", "remove", "move", "copy", "uploadToSignedUrl"]);

/** An rpc may run when it is an org-server function or a known read (RPC_WRITES maps reads to null). */
function rpcAllowed(name: string): boolean {
  return ORG_RPCS.has(name) || RPC_WRITES[name] === null;
}

/**
 * The crdt_updates resource types a read-only desktop may append: the live-share
 * documents the org server still holds (the files-mode set, FILES_MODE_CRDT_TYPES).
 * Every other type is personal document data and stays in the folder.
 */
const LIVE_SHARE_CRDT_TYPES: ReadonlySet<string> = new Set(FILES_MODE_CRDT_TYPES);

/** A crdt_updates write passes only as an insert whose every row is a live-share type. */
function guardCrdtUpdates<B extends object>(builder: B): B {
  return new Proxy(builder, {
    get(target, prop) {
      if (prop === "insert") {
        return (rows: unknown, ...rest: unknown[]) => {
          const list = Array.isArray(rows) ? rows : [rows];
          const shared = list.every((r) => LIVE_SHARE_CRDT_TYPES.has(String((r as { resource_type?: unknown }).resource_type)));
          if (!shared) throw new ReadOnlyError();
          const insert = Reflect.get(target, "insert", target) as (...a: unknown[]) => unknown;
          return insert.call(target, rows, ...rest);
        };
      }
      if (typeof prop === "string" && DB_WRITE_METHODS.has(prop)) {
        return () => {
          throw new ReadOnlyError();
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** A query builder for `table`: write methods throw unless the table is an org-server write table. */
function guardBuilder<B extends object>(builder: B, table: string): B {
  if (table === "crdt_updates") return guardCrdtUpdates(builder);
  if (ORG_WRITE_TABLES.has(table)) return builder;
  return new Proxy(builder, {
    get(target, prop) {
      if (typeof prop === "string" && DB_WRITE_METHODS.has(prop)) {
        return () => {
          throw new ReadOnlyError();
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** A storage bucket handle: writes are refused unless the bucket is an org-server bucket. */
function guardBucket<B extends object>(bucket: B, name: string, orgBuckets: ReadonlySet<string>): B {
  if (orgBuckets.has(name)) return bucket;
  return new Proxy(bucket, {
    get(target, prop) {
      if (typeof prop === "string" && STORAGE_WRITE_METHODS.has(prop)) {
        return () => {
          throw new ReadOnlyError();
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** The storage client: `from(bucket)` hands out guarded bucket handles. */
function guardStorage<S extends object>(storage: S, orgBuckets: ReadonlySet<string>): S {
  return new Proxy(storage, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (prop === "from" && typeof value === "function") {
        return (name: string) => guardBucket(value.call(target, name) as object, name, orgBuckets);
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Guards the database client of a read-only backend. `from` hands out builders
 * whose writes are refused except on org-server tables, `rpc` runs only
 * org-server functions or reads, `storage` refuses writes outside `orgBuckets`,
 * and `schema` returns a guarded client too. A personal write cannot reach the
 * database or the blob store. Wrap the client before any repository is built on it.
 */
export function readOnlyDb<T extends object>(db: T, orgBuckets: readonly string[] = ORG_SERVER_BUCKETS): T {
  const buckets: ReadonlySet<string> = new Set(orgBuckets);
  return new Proxy(db, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (prop === "storage" && value && typeof value === "object") return guardStorage(value, buckets);
      if (typeof value !== "function") return value;
      if (prop === "from") {
        return (table: string) => guardBuilder(value.call(target, table), table);
      }
      if (prop === "rpc") {
        return (name: string, ...args: unknown[]) => {
          if (!rpcAllowed(name)) throw new ReadOnlyError();
          return value.call(target, name, ...args);
        };
      }
      if (prop === "schema") {
        return (name: string) => readOnlyDb(value.call(target, name) as object, orgBuckets);
      }
      return value.bind(target);
    },
  });
}
