"use client";

import type { ParsedReference, ReaderAnnotation } from "@weaveforge/core";
import type { ResolvedReference } from "../application/reference-lookup";

export interface ReferencesPanelProps {
  references: readonly ParsedReference[];
  /** Resolution by reference index, as the lookup service has filled it in. */
  resolutions: ReadonlyMap<number, ResolvedReference>;
  /** Current page, so the panel can mark where the reader is. */
  pageNumber?: number;
  onJumpToMention: (reference: ParsedReference) => void;
  /** True when the reference list was never found in the PDF. */
  parseFailed?: boolean;
  /** True while the initial parse pass is still running. */
  loading?: boolean;
  /** Annotations created in this document, so highlighted passages can be used as references. */
  annotations?: readonly ReaderAnnotation[];
}

function inLibraryLabel(resolution: ResolvedReference): string | null {
  // Resolved only means a provider knows the paper; the pill is for entries
  // the lookup found in this workspace's library.
  if (resolution.status !== "resolved" || !resolution.inLibrary) return null;
  return `In library · ${resolution.inLibrary.status}`;
}

/**
 * Every reference the paper cites, in the order it cites them.
 *
 * This is the panel a reader falls back to when a mention is hard to click —
 * a superscript, a cluster of three numbers, or a mention the text geometry
 * could not measure. It also answers the question the popover cannot: what the
 * whole bibliography looks like and which parts of it are already here.
 *
 * Nothing here resolves anything itself; it renders whatever the service has
 * filled in, so a slow resolver shows the entry immediately and fills the rest
 * in place rather than blocking the list.
 */
export function ReferencesPanel({
  references,
  resolutions,
  pageNumber,
  onJumpToMention,
  parseFailed = false,
  loading = false,
  annotations = [],
}: ReferencesPanelProps) {
  const textAnnotations = annotations.filter((ann) => ann.text && ann.text.trim().length > 0);

  if (loading) {
    return <p className="muted pdf-reader-refs-empty">Reading the reference list…</p>;
  }

  if (parseFailed || references.length === 0) {
    return (
      <div className="pdf-reader-refs" style={{ display: "grid", gap: "10px" }}>
        <p className="muted pdf-reader-refs-empty" style={{ margin: 0, padding: 0 }}>
          {parseFailed
            ? "No bibliography section was automatically detected in this PDF."
            : "The reference list was detected, but no entries could be separated from it."}
        </p>
        {textAnnotations.length > 0 ? (
          <div className="pdf-reader-refs-highlights">
            <p className="pdf-reader-refs-summary" style={{ fontWeight: 600 }}>
              Highlighted reference passages ({textAnnotations.length}):
            </p>
            <ol className="pdf-reader-refs-list">
              {textAnnotations.map((ann, i) => {
                const text = ann.text.trim();
                const query = encodeURIComponent(text);
                const page = ann.anchor.zoteroPosition?.pageIndex != null ? ann.anchor.zoteroPosition.pageIndex + 1 : undefined;
                return (
                  <li key={ann.id} className="pdf-reader-refs-item">
                    <span className="pdf-reader-refs-label">[{i + 1}]</span>
                    <span className="pdf-reader-refs-body">
                      <span className="pdf-reader-refs-title">{text}</span>
                      <span className="muted pdf-reader-refs-meta">
                        {page ? `p. ${page} · ` : ""}
                        <a
                          className="link-btn"
                          href={`https://scholar.google.com/scholar?q=${query}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Scholar ↗
                        </a>
                        {" · "}
                        <a
                          className="link-btn"
                          href={`https://www.semanticscholar.org/search?q=${query}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Semantic Scholar ↗
                        </a>
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : (
          <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>
            Tip: Highlight a reference on the page to search Google Scholar or save it.
          </p>
        )}
      </div>
    );
  }

  const seenOnPage = references.filter((reference) => reference.page === pageNumber).length;

  return (
    <section className="pdf-reader-refs" aria-label="References">
      <p className="muted pdf-reader-refs-summary">
        {references.length} reference{references.length === 1 ? "" : "s"}
        {pageNumber ? ` · ${seenOnPage} on page ${pageNumber}` : ""}
      </p>
      <ol className="pdf-reader-refs-list">
        {references.map((reference) => {
          const resolution = resolutions.get(reference.index);
          const inLibrary = resolution ? inLibraryLabel(resolution) : null;
          const title =
            resolution?.status === "resolved" && resolution.metadata.title
              ? resolution.metadata.title
              : reference.title;
          return (
            <li key={`${reference.index}-${reference.page}`} className="pdf-reader-refs-item">
              <button
                type="button"
                className="link-btn pdf-reader-refs-label"
                onClick={() => onJumpToMention(reference)}
                title={`Jump to where [${reference.index}] is cited`}
              >
                {reference.label ?? `[${reference.index}]`}
              </button>
              <span className="pdf-reader-refs-body">
                {title ? <span className="pdf-reader-refs-title">{title}</span> : null}
                <span className="muted pdf-reader-refs-meta">
                  {[
                    reference.authors.slice(0, 3).join(", ") +
                      (reference.authors.length > 3 ? ` +${reference.authors.length - 3}` : ""),
                    reference.year,
                    `p. ${reference.page}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {inLibrary ? <span className="pdf-reader-ref-pill">{inLibrary}</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}