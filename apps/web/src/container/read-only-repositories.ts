import { ManageSettingsUseCase, type ISettingsRepository } from "@weaveforge/core";
import { RPC_WRITES } from "@/backend/providers/postgrest/watch-writes";
import { systemClock } from "@/lib/parts";
import { ORG_SERVER_RPCS, ORG_SERVER_TABLES } from "./org-server-allowlist";
import { PERSONAL_ALIASES, PERSONAL_REPOSITORY_KEYS } from "./with-file-repositories";

/**
 * The desktop fallback for 0.9.7: when this device's old local database has
 * not been exported, its repositories answer reads and refuse every write, so
 * nothing can change data that the export has not yet copied to files.
 *
 * A method counts as a write when its name starts with a write verb. The
 * iteration test in container/test checks every method of every repository, so
 * a new write method with a verb name cannot slip past unwrapped.
 */
export const READ_ONLY_MESSAGE = "read-only until export verified";

const WRITE_VERB =
  /^(create|save|set|update|upsert|put|add|insert|delete|remove|move|rename|pin|unpin|track|untrack|clear|reset|import|append|write|link|unlink|mark|apply|submit|record|touch|reorder|replace|share|revoke|accept|reject|dismiss|store|sync|bind|register|enqueue|claim|release|lock|unlock|commit|flush|purge|trash|restore)/;

export function isWriteMethod(name: string): boolean {
  return WRITE_VERB.test(name);
}

/** Method names of a repository object, walking its prototype chain (no Object.prototype). */
export function repositoryMethods(repo: object): string[] {
  const names = new Set<string>();
  for (let p: object | null = repo; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const name of Object.getOwnPropertyNames(p)) {
      if (name === "constructor") continue;
      const desc = Object.getOwnPropertyDescriptor(p, name);
      if (desc && typeof desc.value === "function") names.add(name);
    }
  }
  return [...names];
}

/** Wraps one repository: write methods throw, every other method passes through. */
export function readOnlyRepository<T extends object>(repo: T): T {
  const wrapped: Record<string, unknown> = {};
  for (const name of repositoryMethods(repo)) {
    const original = (repo as Record<string, unknown>)[name] as (...args: unknown[]) => unknown;
    wrapped[name] = isWriteMethod(name)
      ? () => {
          throw new Error(READ_ONLY_MESSAGE);
        }
      : (...args: unknown[]) => original.apply(repo, args);
  }
  return wrapped as T;
}

/** Wraps every repository object of a backend bag; non-object fields pass through. */
export function readOnlyRepositories<T extends object>(repos: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(repos)) {
    out[key] = value && typeof value === "object" ? readOnlyRepository(value) : value;
  }
  return out as T;
}

/**
 * The backend keys a read-only backend wraps: every personal repository, its alias
 * keys (the Zotero collection and quotation types), and the settings use case. Named
 * explicitly, so a key is never guessed from its name; the org and sharing keys stay live.
 */
export const READ_ONLY_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(PERSONAL_REPOSITORY_KEYS),
  ...Object.keys(PERSONAL_ALIASES),
  "manageSettings",
]);

const ORG_TABLES: ReadonlySet<string> = new Set(ORG_SERVER_TABLES);
const ORG_RPCS: ReadonlySet<string> = new Set(ORG_SERVER_RPCS);
const DB_WRITE_METHODS: ReadonlySet<string> = new Set(["insert", "update", "upsert", "delete"]);

/** An rpc may run when it is an org-server function or a known read (RPC_WRITES maps reads to null). */
function rpcAllowed(name: string): boolean {
  return ORG_RPCS.has(name) || RPC_WRITES[name] === null;
}

/** A query builder for `table`: write methods throw unless the table is org-server. */
function guardBuilder<B extends object>(builder: B, table: string): B {
  if (ORG_TABLES.has(table)) return builder;
  return new Proxy(builder, {
    get(target, prop) {
      if (typeof prop === "string" && DB_WRITE_METHODS.has(prop)) {
        return () => {
          throw new Error(READ_ONLY_MESSAGE);
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Guards the database client of a read-only backend. `from` hands out builders
 * whose writes are refused except on org-server tables, and `rpc` runs only
 * org-server functions or reads, so a personal write cannot reach the database.
 */
export function readOnlyDb<T extends object>(db: T): T {
  return new Proxy(db, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (prop === "from") {
        return (table: string) => guardBuilder(value.call(target, table), table);
      }
      if (prop === "rpc") {
        return (name: string, ...args: unknown[]) => {
          if (!rpcAllowed(name)) throw new Error(READ_ONLY_MESSAGE);
          return value.call(target, name, ...args);
        };
      }
      return value.bind(target);
    },
  });
}

/**
 * Wraps the explicitly listed repository keys of a wired backend and guards its
 * database client. The settings use case is rebuilt over the wrapped settings
 * repository, so settings and credential writes reach no live repository. Other
 * keys (org, sharing, use cases, config) are left as wired.
 */
export function readOnlyBackend<T extends object>(backend: T): T {
  const out: Record<string, unknown> = { ...(backend as Record<string, unknown>) };
  for (const key of READ_ONLY_KEYS) {
    const value = out[key];
    if (value && typeof value === "object") out[key] = readOnlyRepository(value);
  }
  const settings = out.settingsRepository;
  if (settings && typeof settings === "object") {
    out.manageSettings = new ManageSettingsUseCase({
      repository: readOnlyRepository(settings) as ISettingsRepository,
      clock: systemClock,
    });
  }
  if (out.db && typeof out.db === "object") out.db = readOnlyDb(out.db);
  return out as T;
}
