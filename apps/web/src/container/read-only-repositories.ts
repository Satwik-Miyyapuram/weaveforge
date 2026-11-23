import { ManageSettingsUseCase, type ISettingsRepository } from "@weaveforge/core";
import { RPC_WRITES } from "@/backend/providers/postgrest/watch-writes";
import { systemClock } from "@/lib/parts";
import { FILES_MODE_CRDT_TYPES } from "@/features/collab/infrastructure/files-mode-crdt-limit";
import { ORG_SERVER_BUCKETS, ORG_SERVER_RPCS, ORG_SERVER_WRITE_TABLES } from "./org-server-allowlist";
import { PERSONAL_ALIASES, PERSONAL_REPOSITORY_KEYS } from "./with-file-repositories";

/**
 * The desktop fallback for 0.9.7: when this device's old local database has
 * not been exported, its repositories answer only the reads named in
 * READ_ONLY_METHODS and refuse every other method. Default-deny: a method that
 * is not on a repository's list (a write, a helper, or a name nobody listed)
 * throws ReadOnlyError, so nothing can change data that the export has not yet
 * copied to files.
 *
 * Each allowlisted name is a real read in the repository source (the wiring's
 * read lists, or the file repository body checked by hand). No write method is
 * on any list. The tests check that every listed name exists on its repository.
 */
export const READ_ONLY_MESSAGE = "read-only until export verified";

export class ReadOnlyError extends Error {
  constructor() {
    super(READ_ONLY_MESSAGE);
    this.name = "ReadOnlyError";
  }
}

/**
 * The reads each read-only backend key may run, by method name. A key absent
 * here allows no method. Settings and credential writes (saveAppearance,
 * acceptDisclaimer, saveNoticeSeen, save) are deliberately absent.
 */
export const READ_ONLY_METHODS: Readonly<Record<string, readonly string[]>> = {
  paperRepository: [
    "getById",
    "list",
    "listSummaries",
    "findByArxivId",
    "findByDoi",
    "findByTitleKey",
    "findIdentityByArxivId",
    "findIdentityByDoi",
  ],
  tagRepository: ["getById", "findByName", "list", "listAll", "listWithCounts", "listForPaper", "listPapersForTag", "listPaperTagLinks"],
  paperTagRepository: ["listForPaper", "listForTag", "listAll"],
  logEntryRepository: ["getById", "list"],
  reportSectionRepository: ["getById", "list", "getTree"],
  rawVaultPageRepository: ["getById", "list", "listStamps", "listByIds", "listSummaries", "getTree", "titleTaken"],
  readingListRepository: ["getById", "listByIds", "list", "getTree"],
  readingListItemRepository: [
    "listItems",
    "listItemsForLists",
    "listsForPaper",
    "listsForNote",
    "find",
    "findNote",
    "unreadablePaths",
    "legacyLeftovers",
  ],
  screeningRepository: ["listForItems"],
  paperRelationRepository: ["getById", "list", "getGraph", "relationsFor", "findEdge"],
  experimentRepository: ["getById", "list"],
  milestoneRepository: ["getById", "list"],
  projectRepository: ["getById", "list"],
  dashboardLayoutRepository: ["get"],
  graphSettingsRepository: ["get"],
  integrationsStore: ["get"],
  aiAuditStore: ["countAccepted"],
  settingsRepository: ["get", "getMetadata"],
  libraryPinRepository: ["listForProject", "isPinned"],
  citationAlertTrackRepository: ["listForProject", "getByPaperId"],
  annotationPinRepository: ["listForProject", "listForPaper", "listForSection"],
  annotationQuotationTypeRepository: ["listForPaper"],
  quotationTypeRepository: ["listForPaper"],
  labSnapshotRepository: ["listMine", "listForMember", "getById"],
  readerAnnotationRepository: ["list", "listForProject"],
  paperFieldRepository: ["listDefs", "listValuesForPaper", "listValuesForProject"],
  projectBibliographyCollection: ["getCollection"],
  bibliographyCollectionStore: ["getCollection"],
};

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

/**
 * Wraps one repository: the named reads pass through, every other method returns a
 * rejected promise with ReadOnlyError. Repository methods are async, so a refusal
 * is a rejection, the same shape an awaiting caller already handles.
 */
export function readOnlyRepository<T extends object>(repo: T, allowed: readonly string[] = []): T {
  const reads = new Set(allowed);
  const wrapped: Record<string, unknown> = {};
  for (const name of repositoryMethods(repo)) {
    const original = (repo as Record<string, unknown>)[name] as (...args: unknown[]) => unknown;
    wrapped[name] = reads.has(name)
      ? (...args: unknown[]) => original.apply(repo, args)
      : () => Promise.reject(new ReadOnlyError());
  }
  return wrapped as T;
}

/** Wraps every repository object of a bag with its READ_ONLY_METHODS list; non-object fields pass through. */
export function readOnlyRepositories<T extends object>(repos: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(repos)) {
    out[key] = value && typeof value === "object" ? readOnlyRepository(value, READ_ONLY_METHODS[key] ?? []) : value;
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

/**
 * Guards a blob store: `upload` and `remove` reject with ReadOnlyError unless the
 * bucket is in `orgBuckets`; signing and every other read pass through. The
 * browser's tiered store (HttpBlobStore) talks to the server over fetch, not
 * through `db.storage`, so readOnlyDb alone does not cover it.
 */
export function readOnlyBlobStore<T extends object>(store: T, orgBuckets: readonly string[] = ORG_SERVER_BUCKETS): T {
  const buckets: ReadonlySet<string> = new Set(orgBuckets);
  return new Proxy(store, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (prop === "upload" || prop === "remove") {
        return (bucket: string, ...rest: unknown[]) =>
          buckets.has(bucket) ? value.call(target, bucket, ...rest) : Promise.reject(new ReadOnlyError());
      }
      return value.bind(target);
    },
  });
}

/**
 * Wraps the explicitly listed repository keys of a wired backend and guards its
 * database client and blob store. The settings use case is rebuilt over the wrapped
 * settings repository, so settings and credential writes reach no live repository.
 * Other keys (org, sharing, use cases, config) are left as wired.
 */
export function readOnlyBackend<T extends object>(backend: T): T {
  const out: Record<string, unknown> = { ...(backend as Record<string, unknown>) };
  for (const key of READ_ONLY_KEYS) {
    const value = out[key];
    if (value && typeof value === "object") out[key] = readOnlyRepository(value, READ_ONLY_METHODS[key] ?? []);
  }
  const settings = out.settingsRepository;
  if (settings && typeof settings === "object") {
    out.manageSettings = new ManageSettingsUseCase({
      repository: readOnlyRepository(settings, READ_ONLY_METHODS.settingsRepository ?? []) as ISettingsRepository,
      clock: systemClock,
    });
  }
  if (out.db && typeof out.db === "object") out.db = readOnlyDb(out.db);
  if (out.rawBlobStore && typeof out.rawBlobStore === "object") out.rawBlobStore = readOnlyBlobStore(out.rawBlobStore);
  return out as T;
}
