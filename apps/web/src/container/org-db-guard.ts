import { ORG_SERVER_BUCKETS, ORG_SERVER_READ_TABLES, ORG_SERVER_RPCS } from "./org-server-allowlist";

const TABLES = new Set<string>(ORG_SERVER_READ_TABLES);
const BUCKETS = new Set<string>(ORG_SERVER_BUCKETS);
const RPCS = new Set<string>(ORG_SERVER_RPCS);

/** The part of the PostgREST client the guard checks. Every other member passes through unchanged. */
interface OrgDbLike {
  from(table: string): unknown;
  rpc(name: string, body?: unknown): unknown;
}

interface SchemaDbLike extends OrgDbLike {
  schema(name: string): unknown;
}

interface StorageLike {
  from(bucket: string): unknown;
}

/**
 * The storage client with `from(bucket)` refused, before any request, for a bucket outside the org list.
 * Every other method (listBuckets, emptyBucket, deleteBucket, ...) throws: the app needs none of them.
 */
function orgBucketsOnly<S extends StorageLike>(storage: S): S {
  return new Proxy(storage, {
    get(target, key, receiver) {
      if (key === "from") {
        return (bucket: string) => {
          if (!BUCKETS.has(bucket)) throw new Error(`Bucket not allowed on the org server: ${bucket}`);
          return target.from(bucket);
        };
      }
      if (typeof Reflect.get(target, key, receiver) === "function") {
        return () => {
          throw new Error(`Storage call not allowed on the org server: ${String(key)}`);
        };
      }
      return Reflect.get(target, key, receiver);
    },
  });
}

/**
 * Wraps the org server db so only allowlisted tables and rpcs are reachable. Personal data is
 * never sent to the server; a call outside the list throws before any request is made.
 * `schema()` hands back another client, so that client is guarded too. Writes to allowlisted
 * tables are not checked here; readOnlyDb does that on desktop and no-account.
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
      // A personal blob never reaches the server: any storage call, read or write, outside the org buckets throws.
      if (key === "storage") {
        const storage: unknown = Reflect.get(target, key, receiver);
        return storage && typeof storage === "object" ? orgBucketsOnly(storage as StorageLike) : storage;
      }
      if (key === "schema" && "schema" in target) {
        return (name: string) => guardOrgDb((target as unknown as SchemaDbLike).schema(name) as OrgDbLike);
      }
      return Reflect.get(target, key, receiver);
    },
  });
}
