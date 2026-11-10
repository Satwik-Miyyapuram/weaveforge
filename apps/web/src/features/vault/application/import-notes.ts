import { unzipSync } from "fflate";
import { mapLimit } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { readyCore } from "@/lib/rust-core";
import { typedCore } from "@/lib/rust-core";

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
  return (file.webkitRelativePath || file.name).replace(/\\/g, "/");
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
    if (f.name.toLowerCase().endsWith(".zip")) {
      expanded.push(...(await expandZip(f)));
    } else {
      expanded.push(f);
    }
  }

  const mdFiles = expanded.filter((f) => f.name.toLowerCase().endsWith(".md"));
  const skipped = expanded.length - mdFiles.length;

  // Seed the used-title set with existing project notes so imports don't clash.
  const used = new Set<string>((await vault.pageTitles()).map(readyCore().normalizeTitleKey));
  const renamed: { from: string; to: string }[] = [];
  /** normalizeTitleKey(old) → new title (for wikilink rewrite). */
  const renameMap = new Map<string, string>();

  // Create a note for every folder that holds (or leads to) an .md file, parents
  // first, so children can reference their parent id.
  const folderIds = new Map<string, string>();
  const orderedFolders = readyCore().folderKeys(mdFiles.map(relativePathOf));
  for (const key of orderedFolders) {
    const segs = key.split("/");
    const base = segs[segs.length - 1]!;
    const parentKey = segs.slice(0, -1).join("/");
    const title = readyCore().uniqueTitle(base, used);
    if (title !== base) {
      renamed.push({ from: base, to: title });
      renameMap.set(readyCore().normalizeTitleKey(base), title);
    }
    const page = await vault.manageVaultPage.add({
      title,
      parentId: parentKey ? folderIds.get(parentKey) : undefined,
      folder: true,
    });
    folderIds.set(key, page.id);
  }

  // First pass: decide titles (so renames are known before rewriting bodies).
  const planned: { file: File; title: string; parentKey: string; raw: string }[] = [];
  for (const f of mdFiles) {
    const raw = await f.text();
    const base = typedCore().stripKindSuffix(f.name);
    const title = readyCore().uniqueTitle(base, used);
    if (title !== base) {
      renamed.push({ from: base, to: title });
      renameMap.set(readyCore().normalizeTitleKey(base), title);
    }
    planned.push({
      file: f,
      title,
      parentKey: readyCore().folderKey(relativePathOf(f)),
      raw,
    });
  }

  // Folders stay sequential above (children need their parent's id). Notes
  // only point at folders, so they can go in parallel (34-24).
  let created = 0;
  await mapLimit(planned, NOTE_ADD_CONCURRENCY, async (item) => {
    const { body, tags } = readyCore().stripFrontmatter(item.raw);
    const withTags = tags.length ? `${body.trimEnd()}\n\n${tags.map((t) => `#${t}`).join(" ")}\n` : body;
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
