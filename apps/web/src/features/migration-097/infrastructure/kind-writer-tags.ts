import { FileTagRepository } from "@/backend/providers/files/file-tag-repo";
import type { KindWriter } from "../domain/kind-writer";
import type { FileSink, Row } from "../domain/ports";
import { loadSettingsDoc, settingsSection, updateSettingsDoc } from "./settings-json-doc";

const KIND = "tags";

/**
 * Tag colours live under `tags` in `.weaveforge/settings.json`. Every save and every read-back loads the file
 * fresh, changes only the tags, and writes the whole object back. Keys another writer (paperFields, for one)
 * added since this writer last ran are therefore kept. Nothing is cached between calls.
 */
export function createTagsWriter(sink: FileSink): KindWriter {
  // The papers port is empty here: tag renames that rewrite paper tags are
  // the papers group's job and are listed as a gap in the report.
  const emptyPapers = { getById: async () => null, list: async () => [], setTags: async () => {} };

  function repoOver(root: Record<string, unknown>): FileTagRepository {
    return new FileTagRepository(emptyPapers, settingsSection(root));
  }

  return {
    kinds: [KIND],
    async write(kind: string, row: Row): Promise<void> {
      if (kind !== KIND) throw new Error(`kind-writer-tags: unknown kind "${kind}"`);
      const tag = { id: String(row.id), name: String(row.name), color: row.color == null ? undefined : String(row.color) };
      await updateSettingsDoc(sink, "kind-writer-tags", async (doc) => {
        await repoOver(doc).save(tag as never);
      });
    },
    async readBack(kind: string): Promise<Row[]> {
      if (kind !== KIND) throw new Error(`kind-writer-tags: unknown kind "${kind}"`);
      return (await repoOver(await loadSettingsDoc(sink, "kind-writer-tags")).list()).map((t) => ({ ...t }) as Row);
    },
  };
}
