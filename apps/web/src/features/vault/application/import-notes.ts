import { unzipSync } from "fflate";
import { normalizeTitleKey, stripFrontmatter, uniqueTitle } from "@thesis/core";
import { getContainer } from "@/bootstrap";

export interface ImportResult {
  created: number;
  folders: number;
  renamed: { from: string; to: string }[];
  skipped: number;
}

/** Folder segments between the picked root and the file (drops root + filename). */
function folderSegments(relativePath: string): string[] {
  const normalized = relativePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  // webkitdirectory paths include the root folder name as the first segment.
  return parts.slice(1, -1);
}

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
 * Rewrite `[[OldTitle]]` / `[[OldTitle|…]]` / `[[OldTitle#…]]` to the new title
 * when import auto-suffixed a colliding name.
 */
function rewriteWikilinks(body: string, renames: Map<string, string>): string {
  if (renames.size === 0) return body;
  return body.replace(/\[\[([^\[\]\n]+?)\]\]/g, (raw, inner: string) => {
    const pipe = inner.indexOf("|");
    const link = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
    const alias = pipe === -1 ? "" : inner.slice(pipe);
    const hash = link.indexOf("#");
    const target = (hash === -1 ? link : link.slice(0, hash)).trim();
    const rest = hash === -1 ? "" : link.slice(hash);
    const next = renames.get(normalizeTitleKey(target));
    if (!next) return raw;
    return `[[${next}${rest}${alias}]]`;
  });
}

/**
 * Imports a picked folder or .zip of markdown (Obsidian vault / Notion export /
 * any .md tree) into the vault. Folder hierarchy → note nesting; frontmatter
 * tags → #hashtags; `[[wikilinks]]` are rewritten when titles are auto-suffixed.
 */
export async function importNotesFromFiles(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const expanded: File[] = [];
  for (const f of files) {
    if (f.name.toLowerCase().endsWith(".zip")) {
      expanded.push(...(await expandZip(f)));
    } else {
      expanded.push(f);
    }
  }

  const vault = getContainer().vault;
  const mdFiles = expanded.filter((f) => f.name.toLowerCase().endsWith(".md"));
  const skipped = expanded.length - mdFiles.length;

  // Seed the used-title set with existing project notes so imports don't clash.
  const existing = await vault.loadScreenData();
  const used = new Set<string>(existing.flat.map((p) => normalizeTitleKey(p.title)));
  const renamed: { from: string; to: string }[] = [];
  /** normalizeTitleKey(old) → new title (for wikilink rewrite). */
  const renameMap = new Map<string, string>();

  // Create a note for every folder that holds (or leads to) an .md file, parents
  // first, so children can reference their parent id.
  const folderKeys = new Set<string>();
  for (const f of mdFiles) {
    const segs = folderSegments(relativePathOf(f));
    for (let i = 1; i <= segs.length; i += 1) folderKeys.add(segs.slice(0, i).join("/"));
  }
  const folderIds = new Map<string, string>();
  const orderedFolders = [...folderKeys].sort((a, b) => a.split("/").length - b.split("/").length);
  for (const key of orderedFolders) {
    const segs = key.split("/");
    const base = segs[segs.length - 1]!;
    const parentKey = segs.slice(0, -1).join("/");
    const title = uniqueTitle(base, used);
    if (title !== base) {
      renamed.push({ from: base, to: title });
      renameMap.set(normalizeTitleKey(base), title);
    }
    const page = await vault.manageVaultPage.add({
      title,
      parentId: parentKey ? folderIds.get(parentKey) : undefined,
    });
    folderIds.set(key, page.id);
  }

  // First pass: decide titles (so renames are known before rewriting bodies).
  const planned: { file: File; title: string; parentKey: string; raw: string }[] = [];
  for (const f of mdFiles) {
    const raw = await f.text();
    const base = f.name.replace(/\.md$/i, "");
    const title = uniqueTitle(base, used);
    if (title !== base) {
      renamed.push({ from: base, to: title });
      renameMap.set(normalizeTitleKey(base), title);
    }
    planned.push({
      file: f,
      title,
      parentKey: folderSegments(relativePathOf(f)).join("/"),
      raw,
    });
  }

  let created = 0;
  for (const item of planned) {
    const { body, tags } = stripFrontmatter(item.raw);
    const withTags = tags.length ? `${body.trimEnd()}\n\n${tags.map((t) => `#${t}`).join(" ")}\n` : body;
    const rewritten = rewriteWikilinks(withTags, renameMap);
    await vault.manageVaultPage.add({
      title: item.title,
      body: rewritten,
      parentId: item.parentKey ? folderIds.get(item.parentKey) : undefined,
    });
    created += 1;
    onProgress?.(created, mdFiles.length);
  }

  return { created, folders: folderIds.size, renamed, skipped };
}
