import { openFileSettingsSection } from "./file-settings-section";
import { scopedWorkspaceFs } from "./scoped-workspace-fs";
import { wireFileBackend, type FileBackendParts, type FileRepositories } from "./wire-file-backend";

/** The repositories whose files live in a project's own folder; the rest stay at the workspace root. */
export const PROJECT_FOLDER_KEYS = [
  "paperRepository",
  "libraryPinRepository",
  "citationAlertTrackRepository",
  "annotationPinRepository",
  "tagRepository",
  "paperTagRepository",
  "paperFieldRepository",
  "paperRelationRepository",
  "experimentRepository",
  "metricRepository",
  "logEntryRepository",
  "reportSectionRepository",
  "readingListRepository",
  "readingListItemRepository",
  "rawVaultPageRepository",
  "milestoneRepository",
  "readerAnnotationRepository",
  "screeningRepository",
] as const satisfies readonly (keyof FileRepositories)[];

type ProjectKey = (typeof PROJECT_FOLDER_KEYS)[number];
type Methods = Record<string, (...args: unknown[]) => unknown>;

const methodsOf = (set: FileRepositories, key: ProjectKey) => set[key] as unknown as Methods;

/**
 * The file backend over a workspace of project folders: each call goes to the folder of the
 * project that was active when it was made. A workspace whose project sits at the root works as before.
 */
export function wireProjectFileBackend(parts: FileBackendParts, pid: () => string | null): FileRepositories {
  const rootSet = wireFileBackend(parts);
  const projects = rootSet.projectRepository;
  const sets = new Map<string, Promise<FileRepositories>>();
  // Rows read from a project that is not active: their writes go back to that project.
  const homes = new Map<string, string>();

  const openSet = async (folder: string): Promise<FileRepositories> => {
    if (folder === "") return rootSet;
    const settings = await openFileSettingsSection(parts.fs, folder);
    return wireFileBackend({ ...parts, fs: scopedWorkspaceFs(parts.fs, folder), settings });
  };

  const setOf = (id: string, folder: string): Promise<FileRepositories> => {
    const key = `${id}\n${folder}`;
    let set = sets.get(key);
    if (!set) {
      set = openSet(folder);
      sets.set(key, set);
      // A failed open is tried again on the next call.
      set.catch(() => sets.delete(key));
    }
    return set;
  };

  const resolveSet = async (id: string | null): Promise<FileRepositories> => {
    const folder = id === null ? null : await projects.folderOf(id);
    if (id !== null && folder !== null) return setOf(id, folder);
    const all = await projects.list();
    // No project yet: the legacy root.
    if (all.length === 0) return rootSet;
    if (id !== null) throw new Error("This project's folder is not in the workspace.");
    const first = all[0]!.id;
    return setOf(first, (await projects.folderOf(first)) ?? "");
  };

  // Calls made while a folder is being looked up share the lookup, so they keep their order.
  const resolving = new Map<string | null, Promise<FileRepositories>>();
  const reposFor = (id: string | null): Promise<FileRepositories> => {
    let pending = resolving.get(id);
    if (!pending) {
      pending = resolveSet(id).finally(() => resolving.delete(id));
      resolving.set(id, pending);
    }
    return pending;
  };

  const homeOf = (arg: unknown): string | undefined => {
    if (homes.size === 0) return undefined;
    if (typeof arg === "string") return homes.get(arg);
    if (typeof arg !== "object" || arg === null) return undefined;
    const { id, paperId } = arg as { id?: unknown; paperId?: unknown };
    return homes.get(String(id)) ?? homes.get(String(paperId));
  };

  const rememberHome = (result: unknown, home: string): void => {
    for (const row of Array.isArray(result) ? result : [result]) {
      const rowId = typeof row === "object" && row !== null ? (row as { id?: unknown }).id : undefined;
      if (typeof rowId === "string") homes.set(rowId, home);
    }
  };

  const findElsewhere = async (key: ProjectKey, id: string, searched: string | null): Promise<unknown> => {
    for (const project of await projects.list()) {
      if (project.id === searched) continue;
      const row = await methodsOf(await reposFor(project.id), key).getById!(id);
      if (row === null || row === undefined) continue;
      homes.set(id, project.id);
      return row;
    }
    return null;
  };

  const forward = (key: ProjectKey): unknown =>
    new Proxy(methodsOf(rootSet, key), {
      get(target, prop) {
        const member: unknown = Reflect.get(target, prop);
        if (typeof prop !== "string" || typeof member !== "function" || prop === "constructor") return member;
        return async (...args: unknown[]) => {
          const home = homeOf(args[0]);
          const id = home ?? pid();
          const result = await methodsOf(await reposFor(id), key)[prop]!(...args);
          // Rows a call on another project returns (a paper's annotations) are written back there by their own id.
          if (home !== undefined) rememberHome(result, home);
          if (prop !== "getById" || (result !== null && result !== undefined)) return result;
          return findElsewhere(key, args[0] as string, id);
        };
      },
    });

  return { ...rootSet, ...Object.fromEntries(PROJECT_FOLDER_KEYS.map((key) => [key, forward(key)])) };
}
