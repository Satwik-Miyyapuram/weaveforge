"use client";

import type { ParsedReference } from "@weaveforge/core";
import type { ResolvedReference } from "../application/reference-lookup";

export interface ReferencePopoverProps {
  entry: ParsedReference;
  resolution: ResolvedReference;
  onClose: () => void;
  onReadLater?: () => void;
  onAddToList?: () => void;
  onOpenInReader?: () => void;
  onLinkPapers?: () => void;
  onCite?: () => void;
  onAddManually?: () => void;
  onJumpToEntry?: () => void;
  alreadyLinked?: boolean;
  /** How much the analyzer trusted the citation match that opened this. */
  confidence?: number;
}

/** Presentation only; the reader owns positioning, dismissal and mutations. */
export function ReferencePopover(props: ReferencePopoverProps) {
  const { entry, resolution, onClose } = props;
  const metadata = resolution.status === "resolved" ? resolution.metadata : undefined;
  const paper = resolution.status === "resolved" ? resolution.inLibrary : undefined;
  const query = encodeURIComponent(metadata?.title ?? entry.title ?? entry.raw);
  const scholar = `https://scholar.google.com/scholar?q=${query}`;
  const semanticScholar = `https://www.semanticscholar.org/search?q=${query}`;
  // A resolved S2 record carries its own paper page; fall back to a search.
  const s2Link = metadata?.url?.includes("semanticscholar.org") ? metadata.url : semanticScholar;
  const lowConfidence = props.confidence != null && props.confidence < 0.7;
  const action = (label: string, onClick?: () => void, primary = false) => (
    <button type="button" className={primary ? "btn-primary" : "btn-secondary"} disabled={!onClick} onClick={onClick}>{label}</button>
  );
  return (
    <section className="pdf-reader-ref-body" aria-label="Reference details" aria-busy={resolution.status === "pending"}>
      <button type="button" className="link-btn" aria-label="Close reference details" onClick={onClose}>Close</button>
      {props.confidence != null && (
        <p className="pdf-reader-ref-pill" title="How confidently the analyzer matched this citation to a bibliography entry.">
          {lowConfidence ? "Low-confidence match" : "Match"} · {Math.round(props.confidence * 100)}%
        </p>
      )}
      {resolution.status === "pending" ? (
        // The entry the document printed is known the instant the citation is
        // clicked; only the online metadata is still on its way. Show what is
        // known now and let the lookup enrich it, rather than hiding the entry
        // behind a skeleton for as long as the network takes.
        <div>
          {entry.title ? (
            <>
              <h3>{entry.title}</h3>
              <p>{[entry.authors.join(", "), entry.year, entry.venue].filter(Boolean).join(" · ")}</p>
            </>
          ) : (
            <p className="pdf-reader-ref-raw">{entry.raw}</p>
          )}
          <p className="pdf-reader-ref-skeleton" role="status">Looking up online…</p>
          <div className="pdf-reader-ref-actions">
            <a className="btn-primary" href={semanticScholar} target="_blank" rel="noopener noreferrer">Semantic Scholar ↗</a>
            <a className="btn-secondary" href={scholar} target="_blank" rel="noopener noreferrer">Scholar ↗</a>
          </div>
          {action("Jump to entry", props.onJumpToEntry)}
        </div>
      ) : resolution.status === "unresolved" ? (
        <div>
          <p className="pdf-reader-ref-raw">{entry.raw}</p>
          <p role="status">No match found</p>
          <div className="pdf-reader-ref-actions">
            <a className="btn-primary" href={semanticScholar} target="_blank" rel="noopener noreferrer">Semantic Scholar ↗</a>
            <a className="btn-secondary" href={scholar} target="_blank" rel="noopener noreferrer">Scholar ↗</a>
          </div>
          {action("Add manually", props.onAddManually)}
          {action("Jump to entry", props.onJumpToEntry)}
        </div>
      ) : (
        <div>
          <h3>{resolution.metadata.title}</h3>
          <p>{[resolution.metadata.authors?.join(", "), resolution.metadata.year, resolution.metadata.venue].filter(Boolean).join(" · ")}</p>
          {paper && <p role="status">In library · {paper.status.replaceAll("_", " ")}</p>}
          <div className="pdf-reader-ref-actions">
            {paper ? action("Open in reader", props.onOpenInReader, true) : action("Read later", props.onReadLater, true)}
            {paper ? !props.alreadyLinked && action("Link papers", props.onLinkPapers) : action("Add to list", props.onAddToList)}
            {action("Cite", props.onCite)}
          </div>
          <footer>
            <span>{resolution.sourceId}</span>{" · "}
            <a href={s2Link} target="_blank" rel="noopener noreferrer">Semantic Scholar ↗</a>
            {" · "}
            <a href={scholar} target="_blank" rel="noopener noreferrer">Scholar ↗</a>
            {resolution.metadata.doi && <>{" · "}<a href={`https://doi.org/${encodeURIComponent(resolution.metadata.doi)}`} target="_blank" rel="noopener noreferrer">DOI ↗</a></>}
          </footer>
        </div>
      )}
    </section>
  );
}
