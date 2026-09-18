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
}

/** Presentation only; the reader owns positioning, dismissal and mutations. */
export function ReferencePopover(props: ReferencePopoverProps) {
  const { entry, resolution, onClose } = props;
  const metadata = resolution.status === "resolved" ? resolution.metadata : undefined;
  const paper = resolution.status === "resolved" ? resolution.inLibrary : undefined;
  const scholar = `https://scholar.google.com/scholar?q=${encodeURIComponent(metadata?.title ?? entry.title ?? entry.raw)}`;
  const action = (label: string, onClick?: () => void, primary = false) => (
    <button type="button" className={primary ? "btn-primary" : "btn-secondary"} disabled={!onClick} onClick={onClick}>{label}</button>
  );
  return (
    <section className="pdf-reader-ref-body" aria-label="Reference details" aria-busy={resolution.status === "pending"}>
      <button type="button" className="link-btn" aria-label="Close reference details" onClick={onClose}>Close</button>
      {resolution.status === "pending" ? (
        <div title={entry.raw}>
          <div className="pdf-reader-ref-skeleton" role="status">Looking up reference…</div>
          {action("Read later", undefined, true)}
          {action("Add to list")}
        </div>
      ) : resolution.status === "unresolved" ? (
        <div>
          <p className="pdf-reader-ref-raw">{entry.raw}</p>
          <p role="status">No match found</p>
          <a className="btn-primary" href={scholar} target="_blank" rel="noopener noreferrer">Scholar ↗</a>
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
            <a href={scholar} target="_blank" rel="noopener noreferrer">Scholar ↗</a>
            {resolution.metadata.doi && <>{" · "}<a href={`https://doi.org/${encodeURIComponent(resolution.metadata.doi)}`} target="_blank" rel="noopener noreferrer">DOI ↗</a></>}
          </footer>
        </div>
      )}
    </section>
  );
}
