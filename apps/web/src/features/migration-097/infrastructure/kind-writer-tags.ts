import { FileTagRepository, type SettingsSection } from "@/backend/providers/files/file-tag-repo";
import type { KindWriter } from "../domain/kind-writer";
import type { FileSink, Row } from "../domain/ports";
import { sinkAsWorkspaceFs } from "./sink-workspace-fs";

const SETTINGS_PATH = ".weaveforge/settings.json";
const KIND = "tags";

/**
 * Tag colours live under `tags` in `.weaveforge/settings.json`. Every save and every read-back loads the file
 * fresh, changes only the tags, and writes the whole object back. Keys another writer (paperFields, for one)
 * added since this writer last ran are therefore kept. Nothing is cached between calls.
 */
export function createTagsWriter(sink: FileSink): KindWriter {
  const fs = sinkAsWorkspaceFs(sink);

  async function load(): Promise<Record<string, unknown>> {
    // Only a missing file is empty. A read or parse failure must surface, or the
    // write below would wipe every other setting in the file.
    if (!(await fs.stat(SETTINGS_PATH))) return {};
    const parsed: unknown = JSON.parse(await fs.readText(SETTINGS_PATH));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`kind-writer-tags: ${SETTINGS_PATH} is not a JSON object`);
    }
    return parsed as Record<string, unknown>;
  }

  function section(root: Record<string, unknown>): SettingsSection {
    return {
      get(key) {
        let node: unknown = root;
        for (const k of key) {
          if (!node || typeof node !== "object") return undefined;
          node = (node as Record<string, unknown>)[k];
        }
        return node;
      },
      set(key, value) {
        let node = root;
        for (const k of key.slice(0, -1)) {
          const next = node[k];
          if (!next || typeof next !== "object") node[k] = {};
          node = node[k] as Record<string, unknown>;
        }
        const last = key[key.length - 1];
        if (last === undefined) return;
        if (value === undefined) delete node[last];
        else node[last] = value;
      },
    };
  }

  // The papers port is empty here: tag renames that rewrite paper tags are
  // the papers group's job and are listed as a gap in the report.
  const emptyPapers = { getById: async () => null, list: async () => [], setTags: async () => {} };

  function repoOver(root: Record<string, unknown>): FileTagRepository {
    return new FileTagRepository(emptyPapers, section(root));
  }

  return {
    kinds: [KIND],
    async write(kind: string, row: Row): Promise<void> {
      if (kind !== KIND) throw new Error(`kind-writer-tags: unknown kind "${kind}"`);
      const doc = await load();
      const tag = { id: String(row.id), name: String(row.name), color: row.color == null ? undefined : String(row.color) };
      await repoOver(doc).save(tag as never);
      // Write-then-rename so a crash never leaves a half-written settings.json.
      const part = `${SETTINGS_PATH}.part`;
      try {
        await sink.write(part, JSON.stringify(doc, null, 2));
        await sink.rename(part, SETTINGS_PATH);
      } catch (err) {
        // Only the .part is removed: settings.json itself was never touched.
        await sink.remove(part).catch(() => undefined);
        throw err;
      }
    },
    async readBack(kind: string): Promise<Row[]> {
      if (kind !== KIND) throw new Error(`kind-writer-tags: unknown kind "${kind}"`);
      return (await repoOver(await load()).list()).map((t) => ({ ...t }) as Row);
    },
  };
}
