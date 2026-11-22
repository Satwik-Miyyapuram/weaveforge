import { ORG_SERVER_BUCKETS } from "./org-server-allowlist";
import { ReadOnlyError } from "./read-only-repositories";

const refuse = () => {
  throw new ReadOnlyError();
};

/** A bucket handle on which every call, reads included, is refused. */
function refusedBucket(): object {
  return new Proxy({}, { get: () => refuse });
}

/**
 * Wraps the db of a read-only start that has no files yet (0.9.8, before the export verifies).
 * `channel` is refused, so no realtime topic is joined, and every storage call outside
 * ORG_SERVER_BUCKETS is refused, reads included, so no personal blob path reaches the server.
 * Table and rpc calls pass through: guardOrgDb and readOnlyDb check those.
 */
export function serverOffDb<T extends object>(db: T, orgBuckets: readonly string[] = ORG_SERVER_BUCKETS): T {
  const buckets: ReadonlySet<string> = new Set(orgBuckets);
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "channel") return refuse;
      const value: unknown = Reflect.get(target, prop, receiver);
      if (prop === "storage" && value && typeof value === "object") {
        const storage = value as { from(name: string): object };
        return new Proxy(storage, {
          get(s, key) {
            if (key === "from") return (name: string) => (buckets.has(name) ? storage.from(name) : refusedBucket());
            return refuse;
          },
        });
      }
      if (prop === "schema" && typeof value === "function") {
        return (name: string) => serverOffDb(value.call(target, name) as object, orgBuckets);
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
