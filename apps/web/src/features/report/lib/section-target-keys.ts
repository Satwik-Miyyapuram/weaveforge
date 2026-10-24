import type { LatexSectionNode } from "@weaveforge/core";

/**
 * Word-target keys for one level of the section tree: the lowercased title
 * path, robust to line-number churn. A sibling that repeats an earlier title
 * gets `#2`, `#3`, … so two sections never share a target; the first keeps the
 * plain key, so targets already stored stay where they were.
 */
export function sectionTargetKeys(parentPath: readonly string[], nodes: readonly LatexSectionNode[]): string[] {
  const seen = new Map<string, number>();
  return nodes.map((node) => {
    const title = (node.title || "(untitled)").toLowerCase();
    const count = (seen.get(title) ?? 0) + 1;
    seen.set(title, count);
    return [...parentPath, count === 1 ? title : `${title}#${count}`].join(" > ");
  });
}
