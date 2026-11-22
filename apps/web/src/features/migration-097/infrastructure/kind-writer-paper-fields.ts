import { NotFoundError } from "@weaveforge/core";
import { FilePaperFieldRepository } from "@/backend/providers/files/file-paper-field-repo";
import { FilePaperRepository } from "@/features/papers/infrastructure/file-paper-repository";
import type { KindWriter } from "../domain/kind-writer";
import { defsToSettings, PAPER_FIELD_KINDS, projectKey, type FileFieldValue } from "../domain/paper-fields-file";
import type { FileSink, Row } from "../domain/ports";
import { loadSettingsDoc, saveSettingsDoc, settingsSection } from "./settings-json-doc";
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

/**
 * The error a value write reports. Only a NotFoundError keeps its meaning (no paper or definition);
 * anything else gets a fixed code, never the sink's or the repo's text.
 */
export function valueWriteError(err: unknown): Error {
  if (err instanceof NotFoundError) return new Error("paper field value: no paper or definition for it");
  return coded("paper field value: write failed", "paper-value-write-failed");
}

export function createPaperFieldsWriter(sink: FileSink, folders: ReadonlyMap<string, string>): KindWriter {
  const fs = sinkAsWorkspaceFs(sink);

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
        const doc = await loadSettingsDoc(sink, "paper fields");
        await repoAt(folderOf(row.projectId), doc).saveDef({
          id,
          name: def.name,
          // The server CHECK limits kind to the repo's union; defsToSettings keeps it as text.
          kind: def.kind as Parameters<FilePaperFieldRepository["saveDef"]>[0]["kind"],
          options: def.options,
          sortOrder: def.sortOrder,
        });
        await saveSettingsDoc(sink, doc);
        return;
      }
      if (kind === "paperFieldValues") {
        const folder = folderOf(row.projectId);
        try {
          const doc = await loadSettingsDoc(sink, "paper fields");
          await repoAt(folder, doc).setValue({
            paperId: String(row.paperId),
            fieldId: String(row.fieldId),
            value: row.value as FileFieldValue,
          });
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
