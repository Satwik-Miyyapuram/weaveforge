"use client";

import type { Paper } from "@weaveforge/core";

export function paperExternalLink(paper: Paper): { href: string; label: string } | null {
  if (paper.url?.trim()) return { href: paper.url.trim(), label: "Paper link" };
  if (paper.doi?.trim()) return { href: `https://doi.org/${paper.doi.trim()}`, label: "DOI" };
  if (paper.arxivId?.trim()) {
    return { href: `https://arxiv.org/abs/${paper.arxivId.trim()}`, label: "arXiv" };
  }
  return null;
}

export function PaperExternalLink({ paper }: { paper: Paper }) {
  const link = paperExternalLink(paper);
  if (!link) return null;
  return (
    <p className="paper-external-link">
      <a
        href={link.href}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        {link.label} ↗
      </a>
    </p>
  );
}
