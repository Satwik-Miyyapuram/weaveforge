import {
  type ReportSection,
  type ReportSectionTreeNode,
} from "@weaveforge/core";
import { type ReportParentOption } from "./add-section-form";
import { outlineProgress, sectionProgress, type SectionProgress } from "../lib/section-progress";

/** Rolled-up words for the section with this id, when it is in the outline. */
export function progressOf(nodes: readonly ReportSectionTreeNode[], id: string): SectionProgress | undefined {
  for (const n of nodes) {
    if (n.section.id === id) return sectionProgress(n);
    const inChild = progressOf(n.children, id);
    if (inChild) return inChild;
  }
  return undefined;
}

export function collectSectionIds(node: ReportSectionTreeNode): string[] {
  return [node.section.id, ...node.children.flatMap(collectSectionIds)];
}

export function patchSectionInTree(
  nodes: ReportSectionTreeNode[],
  section: ReportSection,
): ReportSectionTreeNode[] {
  return nodes.map((n) =>
    n.section.id === section.id
      ? { ...n, section }
      : { ...n, children: patchSectionInTree(n.children, section) },
  );
}

/** Outline-order list of every section that can be a parent (any depth). */
export function flattenParentOptions(nodes: ReportSectionTreeNode[]): ReportParentOption[] {
  const out: ReportParentOption[] = [];
  const walk = (list: ReportSectionTreeNode[], depth: number) => {
    for (const node of list) {
      out.push({ section: node.section, depth });
      walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return out;
}

/** "4 sections · 4,210 of 12,000 words" above the title, words rolled up from the top-level sections. */
export function sectionsEyebrow(count: number, roots: readonly ReportSectionTreeNode[]): string | undefined {
  if (!count) return undefined;
  const { words, target } = outlineProgress(roots);
  const label = `${count} ${count === 1 ? "section" : "sections"}`;
  return target
    ? `${label} · ${words.toLocaleString()} of ${target.toLocaleString()} words`
    : `${label} · ${words.toLocaleString()} words`;
}
