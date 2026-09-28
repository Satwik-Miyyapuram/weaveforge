import type { ReportSectionTreeNode } from "@weaveforge/core";

export interface SectionProgress {
  words: number;
  target: number | null;
  /** 0 to 100, or null with no target to measure against. */
  pct: number | null;
}

/**
 * Words written under a section, its own text and every subsection's, against
 * its target. A chapter's target covers its subsections; one with no target of
 * its own aims for theirs added up.
 */
export function sectionProgress(node: ReportSectionTreeNode): SectionProgress {
  let words = node.section.wordCount;
  let childTarget = 0;
  for (const child of node.children) {
    const p = sectionProgress(child);
    words += p.words;
    childTarget += p.target ?? 0;
  }
  const target = node.section.targetWords ?? (childTarget || null);
  const pct = target ? Math.min(100, Math.round((words / target) * 100)) : null;
  return { words, target, pct };
}

/** The whole outline: its top-level sections added up. */
export function outlineProgress(roots: readonly ReportSectionTreeNode[]): SectionProgress {
  let words = 0;
  let target = 0;
  for (const root of roots) {
    const p = sectionProgress(root);
    words += p.words;
    target += p.target ?? 0;
  }
  return { words, target: target || null, pct: target ? Math.min(100, Math.round((words / target) * 100)) : null };
}
