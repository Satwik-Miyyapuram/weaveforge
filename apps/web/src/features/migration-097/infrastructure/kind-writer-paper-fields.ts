import { FilePaperFieldRepository } from "@/backend/providers/files/file-paper-field-repo";
import type { SettingsSection } from "@/backend/providers/files/file-tag-repo";
import { FilePaperRepository } from "@/features/papers/infrastructure/file-paper-repository";
import type { KindWriter } from "../domain/kind-writer";
import { defsToSettings, PAPER_FIELD_KINDS, type FileFieldValue } from "../domain/paper-fields-file";
import type { FileSink, Row } from "../domain/ports";
import { sinkAsWorkspaceFs } from "./sink-workspace-fs";

const SETTINGS_PATH = ".weaveforge/settings.json";

/** Settings section over a plain settings object, as the File repos expect (sync get and set). */
function sectionOver(doc: Record<string, unknown>): SettingsSection {
  return {
    get(key) {
      let node: unknown = doc;
      for (const k of key) {
        if (!node || typeof node !== "object") return undefined;
        node = (node as Record<string, unknown>)[k];
      }
      return node;
    },
    set(key, value) {
      let node = doc;
      for (const k of key.slice(0, -1)) {
        if (!node[k] || typeof node[k] !== "object") node[k] = {};
        node = node[k] as Record<string, unknown>;
      }
      const last = key[key.length - 1];
      if (last === undefined) return;
      if (value === undefined) delete node[last];
      else node[last] = value;
    },
  };
}

/**
 * Paper fields over the File repos. Defs go to `.weaveforge/settings.json` `paperFields` through
 * FilePaperFieldRepository.saveDef, with each project's folder as its projectId. Values go into each
 * paper's frontmatter through setValue. `folders` maps each server project id to its folder ("" = root).
 *
 * settings.json is read fresh for every operation and written back whole after a def change, so this
 * writer never holds a stale copy of its own writes. Other writers that cache settings.json (the tags
 * writer) can still overwrite these defs if they write after this one; the run's readBack catches that.
 */
export function createPaperFieldsWriter(sink: FileSink, folders: ReadonlyMap<string, string>): KindWriter {
  const fs = sinkAsWorkspaceFs(sink);

  async function loadDoc(): Promise<Record<string, unknown>> {
    if (!(await fs.stat(SETTINGS_PATH))) return {};
    const parsed: unknown = JSON.parse(await fs.readText(SETTINGS_PATH));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("paper fields: settings.json is not a JSON object");
    }
    return parsed as Record<string, unknown>;
  }

  /** Write-then-rename, so a crash never leaves a half-written settings.json. */
  async function saveDoc(doc: Record<string, unknown>): Promise<void> {
    const part = `${SETTINGS_PATH}.part`;
    try {
      await sink.write(part, JSON.stringify(doc, null, 2));
      await sink.rename(part, SETTINGS_PATH);
    } catch (err) {
      await sink.remove(part).catch(() => undefined);
      throw err;
    }
  }

  function folderOf(projectId: unknown): string {
    const folder = folders.get(String(projectId));
    if (folder === undefined) throw new Error("paper field: project has no folder");
    return folder;
  }

  function repoAt(folder: string, doc: Record<string, unknown>): FilePaperFieldRepository {
    return new FilePaperFieldRepository(new FilePaperRepository(fs, folder), sectionOver(doc), fs, () => folder);
  }

  return {
    kinds: PAPER_FIELD_KINDS,
    async write(kind: string, row: Row): Promise<void> {
      if (kind === "paperFields") {
        const id = String(row.id);
        const def = defsToSettings([row], folders)[id];
        if (!def) throw new Error("paper field: no definition");
        const doc = await loadDoc();
        await repoAt(folderOf(row.projectId), doc).saveDef({
          id,
          name: def.name,
          // The server CHECK limits kind to the repo's union; defsToSettings keeps it as text.
          kind: def.kind as Parameters<FilePaperFieldRepository["saveDef"]>[0]["kind"],
          options: def.options,
          sortOrder: def.sortOrder,
        });
        await saveDoc(doc);
        return;
      }
      if (kind === "paperFieldValues") {
        const doc = await loadDoc();
        try {
          await repoAt(folderOf(row.projectId), doc).setValue({
            paperId: String(row.paperId),
            fieldId: String(row.fieldId),
            value: row.value as FileFieldValue,
          });
        } catch {
          // Fixed code, not the repo's message: the report names no paper or field text.
          throw new Error("paper field value: no paper or definition for it");
        }
        return;
      }
      throw new Error(`kind-writer-paper-fields: unknown kind "${kind}"`);
    },
    async readBack(kind: string): Promise<Row[]> {
      const doc = await loadDoc();
      const out: Row[] = [];
      for (const [projectId, folder] of folders) {
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
