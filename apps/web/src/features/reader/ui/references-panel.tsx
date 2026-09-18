"use client";

import type { ParsedReference } from "@weaveforge/core";
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
}

function inLibraryLabel(resolution: ResolvedReference): string | null {
  if (resolution.status !== "resolved") return null;
  return `In library · ${resolution.inLibrary?.status ?? "saved"}`;
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
}: ReferencesPanelProps) {
  if (parseFailed) {
    return (
      <p className="muted pdf-reader-refs-empty">
        No reference list found in this PDF. Its citations can still be opened from the page.
      </p>
    );
  }
  if (loading) {
    return <p className="muted pdf-reader-refs-empty">Reading the reference list…</p>;
  }
  if (references.length === 0) {
    return (
      <p className="muted pdf-reader-refs-empty">
        The reference list was found, but no entries could be read out of it.
      </p>
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