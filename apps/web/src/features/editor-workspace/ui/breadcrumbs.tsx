"use client";

/**
 * The breadcrumb strip: the path to the document on screen.
 *
 * A pure presentation of `breadcrumbs()` from the application layer, which is
 * where the "follow the list, not the folder" rule is tested. The last crumb
 * carries the kind suffix, because the crumb *is* the path.
 */

import type { Crumb } from "../application/breadcrumbs";
import { kindSuffix } from "./kind";

export function Breadcrumbs({
  crumbs,
  kind,
  onOpen,
}: {
  crumbs: readonly Crumb[];
  /** The kind of the document on screen, for the suffix on the last crumb. */
  kind?: string;
  /** A crumb that names a document can be clicked to open it. */
  onOpen?: (crumb: Crumb) => void;
}) {
  if (crumbs.length === 0) return null;
  const suffix = kind ? kindSuffix(kind) : null;

  return (
    <nav className="breadcrumbs" aria-label="Document path">
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <span className="breadcrumb" key={`${crumb.label}-${index}`}>
            {index > 0 ? (
              <span className="breadcrumb-sep" aria-hidden="true">
                ›
              </span>
            ) : null}
            {crumb.key && onOpen && !last ? (
              <button type="button" className="breadcrumb-btn" onClick={() => onOpen(crumb)}>
                {crumb.label}
              </button>
            ) : (
              <span className={last ? "breadcrumb-current" : "breadcrumb-plain"}>{crumb.label}</span>
            )}
            {last && suffix ? <span className="breadcrumb-ext">{suffix}</span> : null}
          </span>
        );
      })}
    </nav>
  );
}
