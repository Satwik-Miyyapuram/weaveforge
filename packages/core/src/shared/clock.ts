/**
 * Time + id abstractions.
 *
 * Domain factories stay pure and testable by depending on these instead of
 * calling `Date`/`crypto` directly. Concrete implementations are injected at the
 * composition root (Dependency Inversion).
 */

export interface Clock {
  /** ISO-8601 timestamp, e.g. "2026-06-24T12:00:00.000Z". */
  nowIso(): string;
}

export interface IdGenerator {
  newId(): string;
}

/** Calendar date (yyyy-mm-dd) from an ISO timestamp. */
export function isoDate(iso: string): string {
  return iso.slice(0, 10);
}
