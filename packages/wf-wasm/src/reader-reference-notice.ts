/**
 * Reference popover notices (Rust `reader_reference_notice`), re-exported from index.ts. Keeps the
 * signatures of apps/web/src/features/reader/application/reference-notice.ts.
 */
import { addedNotice as rawAddedNotice, noticeFor as rawNoticeFor } from "../pkg/wf_wasm.js";
import type { ReferenceNotice } from "./bindings.js";

export type { ReferenceNotice } from "./bindings.js";

/** The notice to show under `entryIndex`, or null when it is about another entry. */
export function noticeFor(notice: ReferenceNotice | null, entryIndex: number): string | null {
  return rawNoticeFor(notice, entryIndex) as string | null;
}

/** What an add says: a dedupe that found the paper already there did not add it. */
export function addedNotice(created: boolean): string {
  return rawAddedNotice(created);
}
