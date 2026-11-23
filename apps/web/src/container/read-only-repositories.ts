import { ManageSettingsUseCase, type ISettingsRepository } from "@weaveforge/core";
import { systemClock } from "@/lib/parts";
import { ORG_SERVER_BUCKETS } from "./org-server-allowlist";
import { ReadOnlyError, readOnlyDb } from "./org-db-guard";
import { PERSONAL_ALIASES, PERSONAL_REPOSITORY_KEYS } from "./with-file-repositories";

export { READ_ONLY_MESSAGE, ReadOnlyError, readOnlyDb } from "./org-db-guard";

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
