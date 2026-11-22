import { ORG_SERVER_RPCS, ORG_SERVER_TABLES } from "./org-server-allowlist";

const TABLES = new Set<string>(ORG_SERVER_TABLES);
const RPCS = new Set<string>(ORG_SERVER_RPCS);

/** The part of the PostgREST client the guard checks. Every other member passes through unchanged. */
interface OrgDbLike {
  from(table: string): unknown;
  rpc(name: string, body?: unknown): unknown;
}

/**
 * Wraps the org server db so only allowlisted tables and rpcs are reachable. Personal data is
 * never sent to the server; a call outside the list throws before any request is made.
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
      return Reflect.get(target, key, receiver);
    },
  });
}
