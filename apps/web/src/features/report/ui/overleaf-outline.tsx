import { useMemo, useState } from "react";
import { ChevronIcon } from "@/components/chevron-icon";
import { IconButton } from "@/components/button";
import { RowButton } from "@/components/controls";
import { nestOutline, sectionAt, type OutlineItem, type OutlineNode } from "../lib/latex-outline";

/**
 * The open file's headings as Overleaf's file outline: nested, each with a
 * twisty that folds its children. A click jumps the editor to the heading; the
 * heading the cursor is under is marked.
 */
export function OverleafOutline({
  items,
  activeLine,
  onJump,
}: {
  items: readonly OutlineItem[];
  activeLine: number;
  onJump: (line: number) => void;
}) {
  const tree = useMemo(() => nestOutline(items), [items]);
  const current = sectionAt(items, activeLine)?.line;
  const [folded, setFolded] = useState<Set<number>>(() => new Set());
  const toggle = (line: number) => setFolded((was) => {
    const next = new Set(was);
    if (next.has(line)) next.delete(line);
    else next.add(line);
    return next;
  });

  if (!items.length) return <p className="overleaf-outline__empty muted">No sections in this file.</p>;

  const rows = (nodes: OutlineNode[]) =>
    nodes.map((node) => {
      const open = !folded.has(node.line);
      return (
        <li key={node.line}>
          <div className="overleaf-outline__row">
            {node.children.length ? (
              <IconButton size="sm" label={`${open ? "Collapse" : "Expand"} ${node.title}`} onClick={() => toggle(node.line)}>
                <ChevronIcon open={open} variant="expand" size={12} />
              </IconButton>
            ) : (
              <span className="overleaf-outline__twisty" aria-hidden="true" />
            )}
            <RowButton current={node.line === current} title={node.title} onClick={() => onJump(node.line)}>{node.title}</RowButton>
          </div>
          {open && node.children.length > 0 && <ul>{rows(node.children)}</ul>}
        </li>
      );
    });

  return <ul className="overleaf-outline">{rows(tree)}</ul>;
}
