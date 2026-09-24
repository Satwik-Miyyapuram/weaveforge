"use client";

import { useRef } from "react";
import { ReportErrorButton } from "./report-error-button";

/**
 * An error a user is blocked on must be announced, not just coloured red.
 * `role="alert"` makes assistive tech read it when it appears, which matters
 * most on gates (sign-in, unlock, recovery) where the text is the only clue
 * that the action failed.
 *
 * Each one can be reported. `reportable={false}` is for messages about the
 * reader's own input ("the passwords do not match"), which are not bugs.
 */
export function FormError({ children, reportable = true }: { children: React.ReactNode; reportable?: boolean }) {
  const text = useRef<HTMLSpanElement>(null);
  if (!children) return null;
  return (
    <p className="error" role="alert">
      <span ref={text}>{children}</span>
      {reportable ? <ReportErrorButton readMessage={() => text.current?.textContent ?? ""} /> : null}
    </p>
  );
}

/** The same, inline in a toolbar or status line: a save that failed beside the button. */
export function InlineError({ children }: { children: React.ReactNode }) {
  const text = useRef<HTMLSpanElement>(null);
  if (!children) return null;
  return (
    <span className="error" role="alert">
      <span ref={text}>{children}</span>
      <ReportErrorButton readMessage={() => text.current?.textContent ?? ""} />
    </span>
  );
}
