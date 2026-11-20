/**
 * What a save must do with the page's stored chunk, and whether the save may
 * settle as saved. Pure, so the silent-success cases are covered by tests.
 *
 * A save settles ok only when its write landed, or when there was genuinely
 * nothing to write. A page that cannot be written, or a worker that has not
 * answered for this page yet, is unsaved; the status bar must say so.
 */
export type PageRecord = { chunkId: string; chunk: Uint8Array | null; unreadable?: boolean };

export type SavedPage = { bytes: Uint8Array | null; cleared: boolean; pageIndex: number };

export type InkWriteDecision = {
  action: "write" | "remove" | "none";
  ok: boolean;
  reason?: "no-pages" | "unreadable" | "not-ready";
};

export function decideInkWrite(
  current: PageRecord | undefined,
  saved: SavedPage,
  pageIndex: number,
): InkWriteDecision {
  if (!current) return { action: "none", ok: false, reason: "no-pages" };
  // The stored chunk did not read, so its strokes are still in the store; touching it loses them.
  if (current.unreadable) return { action: "none", ok: false, reason: "unreadable" };
  if (saved.bytes) return { action: "write", ok: true };
  if (saved.cleared && saved.pageIndex === pageIndex) {
    return current.chunk ? { action: "remove", ok: true } : { action: "none", ok: true };
  }
  // Worker still loading, or it answered for another page: nothing known to be saved.
  return { action: "none", ok: false, reason: "not-ready" };
}
