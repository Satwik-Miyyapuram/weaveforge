/**
 * The project's JSON data files, read back into the workspace.
 *
 * `relations.json`, `tags.json` and `reading-list-items.json` are two-way like
 * the markdown: a person can add an edge, rename a tag or drop a paper from a
 * list in the folder, and the import offers it in the same preview, with the
 * same counts, as an edited note. Separated from `workspace-folder` because that
 * module is the session's — opening a folder, mirroring it, watching it — and
 * this is the one part that writes rows rather than files.
 */

import {
  JSON_KINDS,
  addCounts,
  changedSide,
  countJsonActions,
  diffJsonData,
  jsonDataPath,
  parseJsonData,
  projectDir,
  type IWorkspaceFs,
  type JsonDiff,
  type JsonDiffEntry,
  type JsonRow,
  type PaperRelation,
  type ReadingListItem,
  type Tag,
  type WorkspaceJsonKind,
  type WorkspaceProject,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { activeProjectOrNull } from "./active-project";
import { baseDigest, readMirrorBase, readMirrorBases, writeMirrorManifest } from "./mirror-manifest";

/**
 * `<project>/.weaveforge/*.json`, diffed by id against what is stored.
 *
 * Read through the container rather than a repository of this feature's own:
 * edges, tags and list membership each belong to the feature that owns them, and
 * this is the one place that has to see all three at once.
 */
export async function jsonDiff(
  folderFiles: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
  base: Readonly<Record<string, string>>,
  project: WorkspaceProject,
): Promise<JsonDiff> {
  const c = getContainer();
  const [relations, tags, lists] = await Promise.all([
    c.graph.relations.getGraph(),
    c.graph.tags.list(),
    c.readingLists.allLists(),
  ]);
  const items = await c.readingLists.listItemsForLists(lists.map((list) => list.id));
  const existing: Record<WorkspaceJsonKind, JsonRow[]> = {
    relations: relations as unknown as JsonRow[],
    tags: tags as unknown as JsonRow[],
    reading_list_items: items as unknown as JsonRow[],
  };

  const projectRoot = projectDir(project);
  const entries: JsonDiffEntry[] = [];
  for (const kind of JSON_KINDS) {
    const path = jsonDataPath(projectRoot, kind);
    const text = folderFiles[path];
    if (text === undefined) continue;
    const parsed = parseJsonData(path, text, kind);
    // A file that will not parse says nothing. Reporting it as "no rows" would
    // read a syntax error as a removal of everything it held.
    if (!parsed) continue;
    entries.push(
      ...diffJsonData(parsed, existing[kind], {
        origin: (changed) =>
          changedSide({
            base: base[changed] || undefined,
            folder: baseDigest(text),
            workspace: current[changed] === undefined ? undefined : baseDigest(current[changed]),
          }),
      }).entries,
    );
  }
  return { entries, counts: countJsonActions(entries) };
}

/** One preview, both halves: the JSON counts added to the markdown's. */
export function mergeImportCounts(
  markdown: Record<string, number>,
  json: JsonDiff,
): JsonDiff["counts"] {
  return addCounts(markdown as JsonDiff["counts"], json.counts);
}

/**
 * Write the folder's JSON rows into the workspace.
 *
 * An update is a `save` with the row as the folder has it, including its id: the
 * id is how these rows are identified, and the repository is what can write one
 * with the id it already has.
 */
export async function applyJsonEntries(json: JsonDiff | undefined): Promise<string[]> {
  if (!json || json.entries.length === 0) return [];
  const c = getContainer();
  const files = new Set<string>();

  for (const entry of json.entries) {
    // A conflict is the reader's to settle, and a JSON row has no per-field
    // merge: applying one side or the other would be a guess at which.
    if (entry.action === "unchanged" || entry.action === "conflict") continue;
    if (entry.kind === "relations") {
      if (entry.action === "removed") await c.graph.relations.delete(entry.existing.id);
      else await c.graph.relations.save(entry.row as unknown as PaperRelation);
    } else if (entry.kind === "tags") {
      if (entry.action === "removed") await c.graph.tags.delete(entry.existing.id);
      else await c.graph.tags.save(entry.row as unknown as Tag);
    } else {
      if (entry.action === "removed") await c.readingLists.items.remove(entry.existing.id);
      else await c.readingLists.items.add(entry.row as unknown as ReadingListItem);
    }
    files.add(entry.path);
  }
  return [...files];
}

/**
 * Record what the folder says for the files an import applied.
 *
 * The two sides agree at that moment, and the base has to say so: the digest it
 * held was the one the app would have written, not the one the reader's edit
 * produced, and leaving it would keep the mirror holding those files back
 * forever — the folder would never be brought back into step.
 */
export async function refreshMirrorBase(
  fs: IWorkspaceFs | null,
  paths: readonly string[],
): Promise<void> {
  if (!fs || paths.length === 0) return;
  const project = await activeProjectOrNull().catch(() => null);
  if (!project) return;
  const projectRoot = projectDir(project);
  const base = await readMirrorBase(fs, projectRoot);
  const bases = await readMirrorBases(fs, projectRoot);
  let touched = false;
  for (const path of paths) {
    const text = await fs.readText(path).catch(() => null);
    if (text === null) continue;
    base[path] = baseDigest(text);
    touched = true;
  }
  if (touched) await writeMirrorManifest(fs, projectRoot, Object.keys(base), base, bases);
}
