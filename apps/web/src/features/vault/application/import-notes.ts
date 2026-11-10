import { unzipSync } from "fflate";
import { mapLimit } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { readyCore } from "@/lib/rust-core";

export interface ImportResult {
  created: number;
  folders: number;
  renamed: { from: string; to: string }[];
  skipped: number;
}

/** The slice of the vault facade an import uses. */
export interface ImportVault {
  /** Titles of the project's notes, for clash checks. */
  pageTitles(): Promise<readonly string[]>;
  manageVaultPage: {
    add(input: { title: string; body?: string; parentId?: string; folder?: boolean }): Promise<{ id: string }>;
  };
}

/**
 * Notes added at once. Titles are already de-duplicated up front, so the adds
 * are independent; the bound keeps a big vault from flooding the connection.
 */
const NOTE_ADD_CONCURRENCY = 4;

function relativePathOf(file: File): string {
  return readyCore().importRelativePath(file.webkitRelativePath, file.name);
}

/** Expand a .zip into synthetic File-like entries with webkitRelativePath set. */
async function expandZip(file: File): Promise<File[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(bytes);
  const out: File[] = [];
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith("/")) continue;
    const name = path.split("/").pop() ?? path;
    const blob = new Blob([data]);
    const f = new File([blob], name);
    Object.defineProperty(f, "webkitRelativePath", { value: path });
    out.push(f);
  }
  return out;
}

/**
 * Imports a picked folder or .zip of markdown (Obsidian vault / Notion export /
 * any .md tree) into the vault. Folder hierarchy → note nesting; frontmatter
 * tags → #hashtags; `[[wikilinks]]` are rewritten when titles are auto-suffixed.
 */
export async function importNotesFromFiles(
  files: File[],
  onProgress?: (done: number, total: number) => void,
  vault: ImportVault = getContainer().vault,
): Promise<ImportResult> {
  const expanded: File[] = [];
  for (const f of files) {
    if (readyCore().isZipFile(f.name)) {
      expanded.push(...(await expandZip(f)));
    } else {
      expanded.push(f);
    }
  }

  const mdFiles = expanded.filter((f) => readyCore().isMarkdownFile(f.name));
  const skipped = expanded.length - mdFiles.length;

  // Decide every folder and note title up front, against the existing project notes, so the
  // renames are known before any body is rewritten.
  const orderedFolders = readyCore().folderKeys(mdFiles.map(relativePathOf));
  const plan = readyCore().planImportTitles(
    orderedFolders,
    mdFiles.map((f) => f.name),
    await vault.pageTitles(),
  );
  const renamed = [...plan.renamed];
  const renameMap = plan.renameMap;

  // Create a note for every folder that holds (or leads to) an .md file, parents
  // first, so children can reference their parent id.
  const folderIds = new Map<string, string>();
  for (const [i, key] of orderedFolders.entries()) {
    const segs = key.split("/");
    const parentKey = segs.slice(0, -1).join("/");
    const page = await vault.manageVaultPage.add({
      title: plan.folderTitles[i]!,
      parentId: parentKey ? folderIds.get(parentKey) : undefined,
      folder: true,
    });
    folderIds.set(key, page.id);
  }

  const planned: { file: File; title: string; parentKey: string; raw: string }[] = [];
  for (const [i, f] of mdFiles.entries()) {
    planned.push({
      file: f,
      title: plan.noteTitles[i]!,
      parentKey: readyCore().folderKey(relativePathOf(f)),
      raw: await f.text(),
    });
  }

  // Folders stay sequential above (children need their parent's id). Notes
  // only point at folders, so they can go in parallel (34-24).
  let created = 0;
  await mapLimit(planned, NOTE_ADD_CONCURRENCY, async (item) => {
    const { body, tags } = readyCore().stripFrontmatter(item.raw);
    const withTags = readyCore().withTagLine(body, tags);
    const rewritten = readyCore().rewriteWikilinks(withTags, renameMap);
    await vault.manageVaultPage.add({
      title: item.title,
      body: rewritten,
      parentId: item.parentKey ? folderIds.get(item.parentKey) : undefined,
    });
    created += 1;
    onProgress?.(created, mdFiles.length);
  });

  return { created, folders: folderIds.size, renamed, skipped };
}
