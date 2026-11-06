import { useEffect, useMemo, useState } from "react";
import { ChevronIcon } from "@/components/chevron-icon";
import { RowButton } from "@/components/controls";
import { FolderIcon } from "@/components/view-icons";
import { buildFileTree, foldersOf, type FileTreeNode } from "../lib/overleaf-file-tree";

/** A page with a folded corner, the file mark in Overleaf's tree. */
const FileGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
    <path d="M14 3v5h5" />
  </svg>
);

/**
 * An Overleaf project's files as Overleaf shows them: nested folders that fold,
 * folders first. The folders holding the open file start open.
 */
export function OverleafFileTree({
  docs,
  activeId,
  onOpen,
}: {
  docs: readonly { id: string; path: string }[];
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  const tree = useMemo(() => buildFileTree(docs), [docs]);
  const activePath = docs.find((d) => d.id === activeId)?.path ?? "";
  const [open, setOpen] = useState<Set<string>>(() => new Set(foldersOf(activePath)));

  // Opening a file elsewhere (the root doc on load) unfolds its folders.
  useEffect(() => {
    const needed = foldersOf(activePath);
    setOpen((was) => (needed.every((f) => was.has(f)) ? was : new Set([...was, ...needed])));
  }, [activePath]);

  const toggle = (path: string) => setOpen((was) => {
    const next = new Set(was);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });

  const rows = (nodes: FileTreeNode[], depth: number) =>
    nodes.map((node) => {
      const indent = { paddingInlineStart: `${8 + 16 * depth}px` };
      if (node.kind === "file") {
        return (
          <li key={node.path}>
            <RowButton current={node.id === activeId} style={indent} title={node.path} onClick={() => onOpen(node.id)}>
              <span className="overleaf-tree__twisty" aria-hidden="true" />
              <FileGlyph />
              <span className="overleaf-tree__name">{node.name}</span>
            </RowButton>
          </li>
        );
      }
      const isOpen = open.has(node.path);
      return (
        <li key={node.path}>
          <RowButton style={indent} aria-expanded={isOpen} title={node.path} onClick={() => toggle(node.path)}>
            <span className="overleaf-tree__twisty" aria-hidden="true">
              <ChevronIcon open={isOpen} variant="expand" size={14} />
            </span>
            <FolderIcon size={14} />
            <span className="overleaf-tree__name">{node.name}</span>
          </RowButton>
          {isOpen && <ul>{rows(node.children, depth + 1)}</ul>}
        </li>
      );
    });

  return (
    <nav className="workshop-live__files" aria-label="Project files">
      <ul className="overleaf-tree">{rows(tree, 0)}</ul>
    </nav>
  );
}
