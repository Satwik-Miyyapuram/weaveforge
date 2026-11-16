/**
 * Which workspace document a canvas file node points to. A node made here
 * holds the workspace path (`notes/Plan.note.md`); one from an Obsidian vault
 * holds a vault path (`Projects/Plan.md`), matched by title, its extension
 * picking the kind: `.canvas` a canvas, `.pdf` a paper's PDF, anything else a
 * note before a paper.
 */

export interface CanvasTarget {
  kind: string;
  id: string;
  title: string;
  path: string;
}

const NOTE_LIKE = ["vault_page", "paper", "report_section", "log_entry"];

function stem(path: string): string {
  const name = path.split("/").pop() ?? "";
  return name.replace(/\.(note|paper|report)\.md$/i, "").replace(/\.[a-z0-9]+$/i, "").toLowerCase();
}

/** The document `file` names, or undefined when the workspace has none. */
export function resolveCanvasFile<D extends CanvasTarget>(docs: readonly D[], file: string): D | undefined {
  if (!file) return undefined;
  const exact = docs.find((doc) => doc.path === file);
  if (exact) return exact;
  const name = stem(file);
  const named = docs.filter((doc) => doc.title.toLowerCase() === name);
  const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase() ?? "md";
  if (ext === "canvas") return named.find((doc) => doc.path.endsWith(".canvas"));
  if (ext === "pdf") return named.find((doc) => doc.kind === "paper_pdf");
  if (ext !== "md") return undefined;
  const notes = named.filter((doc) => !doc.path.endsWith(".canvas"));
  for (const kind of NOTE_LIKE) {
    const hit = notes.find((doc) => doc.kind === kind);
    if (hit) return hit;
  }
  return undefined;
}
