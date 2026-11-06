/** One row of an Overleaf project's file tree: a folder with children, or a file. */
export type FileTreeNode =
  | { kind: "folder"; name: string; path: string; children: FileTreeNode[] }
  | { kind: "file"; name: string; path: string; id: string };

const byName = (a: FileTreeNode, b: FileTreeNode) =>
  a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/**
 * Nests flat doc paths ("chapters/intro.tex") into folders, as Overleaf shows
 * them: folders first, then files, each sorted by name.
 */
export function buildFileTree(docs: readonly { id: string; path: string }[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  for (const doc of docs) {
    const parts = doc.path.split("/").filter(Boolean);
    let level = root;
    let prefix = "";
    for (const folder of parts.slice(0, -1)) {
      prefix += `${folder}/`;
      let node = level.find((n) => n.kind === "folder" && n.name === folder);
      if (!node) {
        node = { kind: "folder", name: folder, path: prefix, children: [] };
        level.push(node);
      }
      level = (node as Extract<FileTreeNode, { kind: "folder" }>).children;
    }
    level.push({ kind: "file", name: parts.at(-1) ?? doc.path, path: doc.path, id: doc.id });
  }
  const sort = (nodes: FileTreeNode[]) => {
    nodes.sort(byName);
    for (const n of nodes) if (n.kind === "folder") sort(n.children);
  };
  sort(root);
  return root;
}

/** The folder paths that hold `path`, outermost first: "a/b/c.tex" gives ["a/", "a/b/"]. */
export function foldersOf(path: string): string[] {
  const parts = path.split("/").filter(Boolean).slice(0, -1);
  return parts.map((_, i) => `${parts.slice(0, i + 1).join("/")}/`);
}
