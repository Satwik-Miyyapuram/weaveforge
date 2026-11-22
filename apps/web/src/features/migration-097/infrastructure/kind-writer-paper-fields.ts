import { ConflictError, NotFoundError } from "@weaveforge/core";
import { FilePaperFieldRepository } from "@/backend/providers/files/file-paper-field-repo";
import { FilePaperRepository } from "@/features/papers/infrastructure/file-paper-repository";
import type { KindWriter } from "../domain/kind-writer";
import { defsToSettings, PAPER_FIELD_KINDS, projectKey, type FileFieldValue } from "../domain/paper-fields-file";
import type { FileSink, Row } from "../domain/ports";
import { loadSettingsDoc, settingsSection, updateSettingsDoc } from "./settings-json-doc";
import { sinkAsWorkspaceFs } from "./sink-workspace-fs";

/**
 * Paper fields over the File repos. Defs go to `.weaveforge/settings.json` `paperFields` through
 * FilePaperFieldRepository.saveDef, with each project's folder as its projectId. Values go into each
 * paper's frontmatter through setValue. `folders` maps each server project id to its folder ("" = root).
 *
 * settings.json is read fresh for every operation and written back whole after a def change, so this
 * writer never holds a stale copy of its own writes. Other writers that cache settings.json (the tags
 * writer) can still overwrite these defs if they write after this one; the run's readBack catches that.
 */
/** An Error with a stable machine code, so the report can name the failure without its text. */
function coded(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/** Reported as `conflict:<kind>`: the file's own value is kept, the export value is not written. */
const KEPT_MESSAGE = "conflict: paper field value differs from the file; kept the file's value";

/**
 * The error a value write reports. Only a NotFoundError keeps its meaning (no paper or definition);
 * a conflict (the file's value differs, or the paper kept changing through the retries) is reported as
 * one. Anything else gets a fixed code, never the sink's or the repo's text.
 */
export function valueWriteError(err: unknown): Error {
  if (err instanceof NotFoundError) return new Error("paper field value: no paper or definition for it");
  if (err instanceof ConflictError || (err instanceof Error && err.message === KEPT_MESSAGE)) return new Error(KEPT_MESSAGE);
  return coded("paper field value: write failed", "paper-value-write-failed");
}

export function createPaperFieldsWriter(sink: FileSink, folders: ReadonlyMap<string, string>): KindWriter {
  // The paper merge is a compare-and-set: it writes only over the text it read, and its retries handle a race.
  const fs = sinkAsWorkspaceFs(sink, { compareAndSet: true });
  /** Values already in each folder's papers, keyed by paper and field: loaded once, then kept up to date. */
  const stored = new Map<string, Map<string, unknown>>();

  async function storedValues(folder: string, doc: Record<string, unknown>): Promise<Map<string, unknown>> {
    let values = stored.get(folder);
    if (!values) {
      values = new Map();
      for (const v of await repoAt(folder, doc).listValuesForProject()) values.set(`${v.paperId}\u0000${v.fieldId}`, v.value);
      stored.set(folder, values);
    }
    return values;
  }

  /** A missing project id is the workspace root, as is an empty one. Any other unmapped id is an error. */
  function folderOf(projectId: unknown): string {
    const key = projectKey(projectId);
    if (key === "") return "";
    const folder = folders.get(key);
    if (folder === undefined) throw new Error("paper field: project has no folder");
    return folder;
  }

  function repoAt(folder: string, doc: Record<string, unknown>): FilePaperFieldRepository {
    return new FilePaperFieldRepository(new FilePaperRepository(fs, folder), settingsSection(doc), fs, () => folder);
  }

  return {
    kinds: PAPER_FIELD_KINDS,
    async write(kind: string, row: Row): Promise<void> {
      if (kind === "paperFields") {
        const id = String(row.id);
        const def = defsToSettings([row], folders)[id];
        if (!def) throw new Error("paper field: no definition");
        const folder = folderOf(row.projectId);
        await updateSettingsDoc(sink, "paper fields", (doc) =>
          repoAt(folder, doc).saveDef({
            id,
            name: def.name,
            // The server CHECK limits kind to the repo's union; defsToSettings keeps it as text.
            kind: def.kind as Parameters<FilePaperFieldRepository["saveDef"]>[0]["kind"],
            options: def.options,
            sortOrder: def.sortOrder,
          }),
        );
        return;
      }
      if (kind === "paperFieldValues") {
        const folder = folderOf(row.projectId);
        const paperId = String(row.paperId);
        const fieldId = String(row.fieldId);
        try {
          const doc = await loadSettingsDoc(sink, "paper fields");
          // The merge only adds missing keys: a value the file already holds that differs is kept and reported.
          const values = await storedValues(folder, doc);
          const key = `${paperId}\u0000${fieldId}`;
          if (values.has(key) && JSON.stringify(values.get(key)) !== JSON.stringify(row.value)) throw new Error(KEPT_MESSAGE);
          await repoAt(folder, doc).setValue({ paperId, fieldId, value: row.value as FileFieldValue });
          values.set(key, row.value);
        } catch (err) {
          // Fixed codes, never the repo's or the sink's text: the report names no paper or field.
          throw valueWriteError(err);
        }
        return;
      }
      throw new Error(`kind-writer-paper-fields: unknown kind "${kind}"`);
    },
    async readBack(kind: string): Promise<Row[]> {
      const doc = await loadSettingsDoc(sink, "paper fields");
      const out: Row[] = [];
      // Each folder is read once, tagged with the first project that maps to it. The root is always read,
      // so defs and values at the root come back even when no project maps to it.
      const tags = new Map<string, string>([["", ""]]);
      for (const [projectId, folder] of folders) if (!tags.has(folder) || tags.get(folder) === "") tags.set(folder, projectId);
      for (const [folder, projectId] of tags) {
        const repo = repoAt(folder, doc);
        if (kind === "paperFields") {
          for (const def of await repo.listDefs()) out.push({ ...def, projectId });
        } else if (kind === "paperFieldValues") {
          for (const value of await repo.listValuesForProject()) out.push({ ...value, projectId });
        } else {
          throw new Error(`kind-writer-paper-fields: unknown kind "${kind}"`);
        }
      }
      return out;
    },
  };
}
