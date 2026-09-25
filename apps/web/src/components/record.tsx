"use client";

import type { ReactNode } from "react";

/*
 * The record page: one item — a paper, a note, an experiment — laid out as a
 * catalogue entry. A serif title, a line of mono metadata, then a reading
 * column of labelled sections and a narrow column of facts beside it.
 *
 * Quiet on purpose. Every section is the same shape (a small uppercase label,
 * a tag on the right, a hairline), so the eye reads the content rather than the
 * chrome, and actions are words with an icon rather than a row of buttons.
 */

/** "18 Dec 2025" — the date a record shows, the same everywhere. */
export function recordDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Words in a markdown body, ignoring markup, links' targets and code fences. */
export function wordCount(markdown: string | null | undefined): number {
  if (!markdown) return 0;
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~[\]|-]/g, " ");
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** A labelled part of the reading column: label left, tag right, hairline under. */
export function RecordSection({
  label,
  tag,
  id,
  children,
}: {
  label: string;
  tag?: ReactNode;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section className="record-section" id={id}>
      <h2 className="record-section-head">
        <span>{label}</span>
        {tag ? <span className="record-section-tag">{tag}</span> : null}
      </h2>
      {children}
    </section>
  );
}

/** What a section says when it has nothing yet — one sentence, and how to fill it. */
export function RecordEmpty({ children }: { children: ReactNode }) {
  return <p className="record-empty">{children}</p>;
}

/** Key / value pairs joined by a dotted leader, as in a library card. */
export function RecordFacts({ rows }: { rows: readonly (readonly [string, ReactNode] | null | false)[] }) {
  return (
    <dl className="record-facts">
      {rows.map((row) =>
        row ? (
          <div key={row[0]} className="record-fact">
            <dt>{row[0]}</dt>
            <span className="record-leader" aria-hidden />
            <dd>{row[1]}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}

/** Dated events, newest first. */
export function RecordActivity({ events }: { events: readonly { at: string; what: ReactNode }[] }) {
  if (events.length === 0) return null;
  return (
    <ol className="record-activity">
      {events.map((event, i) => (
        <li key={i}>
          <span className="record-activity-at">{event.at}</span>
          <span>{event.what}</span>
        </li>
      ))}
    </ol>
  );
}

/** Progress as filled dots — reading status, experiment stage. */
export function RecordDots({ filled, total = 3, label }: { filled: number; total?: number; label: string }) {
  return (
    <span className="record-dots" role="img" aria-label={label} title={label}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < filled ? "is-on" : undefined} />
      ))}
    </span>
  );
}
