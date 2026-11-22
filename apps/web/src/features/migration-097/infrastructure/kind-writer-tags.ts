import { FileTagRepository, type SettingsSection } from "@/backend/providers/files/file-tag-repo";
import type { KindWriter } from "../domain/kind-writer";
import type { FileSink, Row } from "../domain/ports";
import { sinkAsWorkspaceFs } from "./sink-workspace-fs";

const SETTINGS_PATH = ".weaveforge/settings.json";
const KIND = "tags";

/**
 * Tag colours live under `tags` in `.weaveforge/settings.json`. The repo's
 * SettingsSection is sync, so the file is loaded once into a plain object,
 * mutated through the repo, and written back whole after each save.
 */
export function createTagsWriter(sink: FileSink): KindWriter {
  const fs = sinkAsWorkspaceFs(sink);
  let settings: Record<string, unknown> | null = null;

  async function load(): Promise<Record<string, unknown>> {
    if (settings) return settings;
    try {
      const parsed: unknown = JSON.parse(await fs.readText(SETTINGS_PATH));
      settings = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      settings = {};
    }
    return settings;
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

  async function repo(): Promise<FileTagRepository> {
    return new FileTagRepository(emptyPapers, section(await load()));
  }

  return {
    kinds: [KIND],
    async write(kind: string, row: Row): Promise<void> {
      if (kind !== KIND) throw new Error(`kind-writer-tags: unknown kind "${kind}"`);
      const tag = { id: String(row.id), name: String(row.name), color: row.color == null ? undefined : String(row.color) };
      await (await repo()).save(tag as never);
      await sink.write(SETTINGS_PATH, JSON.stringify(await load(), null, 2));
    },
    async readBack(kind: string): Promise<Row[]> {
      if (kind !== KIND) throw new Error(`kind-writer-tags: unknown kind "${kind}"`);
      return (await (await repo()).list()).map((t) => ({ ...t }) as Row);
    },
  };
}
