"use client";

import Link from "next/link";

/**
 * The one way back from a detail page to where it came from: a square chevron
 * box and the name of that place. Every detail screen uses this, so a back
 * control looks and sits the same wherever it is found.
 */
export function BackButton({
  label,
  onClick,
  href,
}: {
  /** Where it goes, e.g. "Papers". */
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const inner = (
    <>
      <span className="back-btn-box" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </span>
      <span className="back-btn-label">{label}</span>
    </>
  );
  const title = `Back to ${label}`;
  return href ? (
    <Link className="back-btn" href={href} title={title}>
      {inner}
    </Link>
  ) : (
    <button type="button" className="back-btn" onClick={onClick} title={title}>
      {inner}
    </button>
  );
}
