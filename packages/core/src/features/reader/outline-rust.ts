/**
 * Outline-from-text helpers, called through the Rust core. The logic lives in
 * `crates/wf-core/src/reader_analysis/outline.rs`; this file only maps the
 * shapes and keeps the TypeScript signatures the reader modules use.
 */
import { rust } from "../../shared/rust.js";
import type { OutlineTextItem, ReaderOutlineItem } from "./outline-types.js";

/** Whether a pdf.js text matrix `[a, b, c, d, e, f]` sets its run rotated or mirrored. */
export function isRotatedText(transform: readonly number[]): boolean {
  return rust().isRotatedText(Float64Array.from(transform));
}

/** Consecutive text runs on a baseline, in reading order. */
export function outlineTextLines(pages: readonly (readonly OutlineTextItem[])[]): OutlineTextItem[] {
  return rust().outlineTextLines(pages) as OutlineTextItem[];
}

/** The most common font size, rounded to a half point; 0 when there is none. */
export function bodyFontSize(pages: readonly (readonly OutlineTextItem[])[]): number {
  return rust().bodyFontSize(pages);
}

/** Infer an outline only when a document supplies no bookmarks. */
export function outlineFromText(allPages: readonly (readonly OutlineTextItem[])[]): ReaderOutlineItem[] {
  return rust().outlineFromText(allPages) as ReaderOutlineItem[];
}

/** True when the headings are at least three, and no stretch without one exceeds half the document. */
export function outlineIsPlausible(headings: readonly { page: number }[], pageCount: number): boolean {
  return rust().outlineIsPlausible(headings, pageCount);
}

/** Group lines by (near-)identical text. Members keep the caller's objects. */
export function groupRecurringLines<T>(
  lines: readonly T[],
  textOf: (line: T) => string,
  pageOf: (line: T) => number,
): { key: string; pages: Set<number>; members: T[] }[] {
  const groups = rust().groupRecurringLines(
    lines.map((line) => textOf(line)),
    lines.map((line) => pageOf(line)),
  ) as { key: string; pages: number[]; members: number[] }[];
  return groups.map((group) => ({
    key: group.key,
    pages: new Set(group.pages),
    members: group.members.map((index) => lines[index]!),
  }));
}
