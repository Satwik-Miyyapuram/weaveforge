import type { Row } from "../domain/ports";

/** A project being exported and its folder in the workspace ("" = the workspace root). */
export type ExportProject = { id: string; folder: string };

/** The folder each row's file belongs in. */
export type ProjectRouter = { readonly folders: readonly string[]; folderOf(kind: string, row: Row): string };

/** Kinds whose file sits with a parent's: the parent's folder wins over the row's own projectId. */
const PARENT_KEYS: Record<string, readonly string[]> = {
  metrics: ["experimentId"],
  annotations: ["paperId"],
  annotationPins: ["paperId"],
  paperFieldValues: ["paperId"],
  citationAlerts: ["paperId"],
  relations: ["fromPaper"],
  readingListItems: ["listId"],
  screening: ["itemId"],
  comments: ["resourceId", "entityId", "targetId"],
};

/** Kinds the app keeps at the workspace root, whatever their project. */
const ROOT_KINDS = new Set(["settings", "quotationTypes", "aiProposals"]);

/**
 * With no projects every row goes to the root. The first project is the main one: a row whose project is
 * missing or not exported goes there, so it still lands in a folder the app reads.
 */
export function createProjectRouter(projects: readonly ExportProject[]): ProjectRouter {
  const folders = new Map(projects.map((p) => [p.id, p.folder]));
  const homes = new Map<string, string>();
  return {
    folders: folders.size === 0 ? [""] : [...new Set(folders.values())],
    folderOf(kind, row) {
      if (folders.size === 0 || ROOT_KINDS.has(kind)) return "";
      let folder: string | undefined;
      for (const key of PARENT_KEYS[kind] ?? []) folder ??= homes.get(String(row[key]));
      if (folder === undefined && typeof row.projectId === "string") folder = folders.get(row.projectId);
      if (folder === undefined && kind === "comments") return "";
      folder ??= projects[0]!.folder;
      if (typeof row.id === "string") homes.set(row.id, folder);
      return folder;
    },
  };
}
