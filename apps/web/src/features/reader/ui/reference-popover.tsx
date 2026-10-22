"use client";

import type { ParsedReference } from "@weaveforge/core";
import type { ResolvedReference } from "../application/reference-lookup";

export interface ReferencePopoverProps {
  entry: ParsedReference;
  resolution: ResolvedReference;
  onClose: () => void;
  onAddToLibrary?: () => void;
  onOpenInReader?: () => void;
  onLinkPapers?: () => void;
  onCite?: () => void;
  onAddManually?: () => void;
  onJumpToEntry?: () => void;
  alreadyLinked?: boolean;
  /** How much the analyzer trusted the citation match that opened this. */
  confidence?: number;
}

/**
 * Presentation only; the reader owns positioning, dismissal and mutations.
 * Deliberately minimal — a title, one line of metadata, one quiet row of
 * actions — so the popover reads like a footnote and not like a dialog.
 */
export function ReferencePopover(props: ReferencePopoverProps) {
  const { entry, resolution, onClose } = props;
  const metadata = resolution.status === "resolved" ? resolution.metadata : undefined;
  const paper = resolution.status === "resolved" ? resolution.inLibrary : undefined;
  const outside = outsideLink(metadata?.title ?? entry.title ?? entry.raw, metadata?.doi, metadata?.url);
  const title = metadata?.title ?? entry.title;
  const meta = [metadata?.authors ?? entry.authors, metadata?.year ?? entry.year, metadata?.venue ?? entry.venue]
    .map((part) => (Array.isArray(part) ? part.join(", ") : part))
    .filter(Boolean)
    .join(" · ");
  const lowConfidence = props.confidence != null && props.confidence < 0.7;
  const action = (label: string, onClick?: () => void) =>
    onClick ? <button type="button" className="pdf-reader-ref-action" onClick={onClick}>{label}</button> : null;
  return (
    <section className="pdf-reader-ref-body" aria-label="Reference details" aria-busy={resolution.status === "pending"}>
      <button type="button" className="pdf-reader-ref-close" aria-label="Close reference details" onClick={onClose}>×</button>
      {title ? (
        <>
          <h3>{title}</h3>
          {meta && <p>{meta}</p>}
        </>
      ) : (
        <p className="pdf-reader-ref-raw">{entry.raw}</p>
      )}
      {resolution.status === "pending" && <p className="pdf-reader-ref-skeleton" role="status">Looking up…</p>}
      {resolution.status === "unresolved" && <p className="pdf-reader-ref-skeleton" role="status">No match found</p>}
      {paper && <p className="pdf-reader-ref-skeleton" role="status">In library · {paper.status.replaceAll("_", " ")}</p>}
      {lowConfidence && <p className="pdf-reader-ref-skeleton">Low-confidence match</p>}
      <div className="pdf-reader-ref-actions">
        {resolution.status === "resolved" && (paper
          ? <>{action("Open in reader", props.onOpenInReader)}{!props.alreadyLinked && action("Link papers", props.onLinkPapers)}</>
          : action("Add to library", props.onAddToLibrary))}
        {resolution.status === "resolved" && action("Copy citation", props.onCite)}
        {resolution.status === "unresolved" && action("Add manually", props.onAddManually)}
        {action("Go to reference", props.onJumpToEntry)}
        <a className="pdf-reader-ref-action" href={outside.href} target="_blank" rel="noopener noreferrer">{outside.label}</a>
      </div>
    </section>
  );
}

/**
 * The one place outside the app worth opening: the paper itself by DOI, else
 * its Semantic Scholar record, else a Google Scholar search for the title.
 */
function outsideLink(title: string, doi?: string, url?: string): { label: string; href: string } {
  if (doi) return { label: "Publisher ↗", href: `https://doi.org/${encodeURIComponent(doi)}` };
  if (url && isSemanticScholar(url)) return { label: "Semantic Scholar ↗", href: url };
  return { label: "Search Scholar ↗", href: `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}` };
}

function isSemanticScholar(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && (hostname === "semanticscholar.org" || hostname.endsWith(".semanticscholar.org"));
  } catch {
    return false;
  }
}
