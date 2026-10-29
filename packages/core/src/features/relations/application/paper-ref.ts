import type { Paper } from "../../papers/domain/paper.js";
import type { PaperRef } from "../../papers/application/metadata-source.js";

/** Prefer arXiv id, fall back to DOI, for resolving a paper externally. */
export function paperRef(paper: Paper): PaperRef | null {
  if (paper.arxivId) return { kind: "arxiv", value: paper.arxivId };
  if (paper.doi) return { kind: "doi", value: paper.doi };
  return null;
}
