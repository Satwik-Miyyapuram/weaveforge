import * as Y from "yjs";

export type TailMerge = { ok: true; state: Uint8Array } | { ok: false; reason: string };

/** Kinds whose rows are stored as a CRDT base plus a tail of later updates. */
export const TAIL_KINDS = ["vault_pages", "report_sections", "log_entries"] as const;

export function isTailKind(kind: string): boolean {
  return (TAIL_KINDS as readonly string[]).includes(kind);
}

/**
 * Fold a base CRDT state and its tail of updates into one state.
 *
 * Only error names are reported: messages can echo document content.
 * An update that needs an update not yet applied leaves structs pending, so it
 * is rejected rather than exported as a silently partial document.
 */
export function foldTail(base: Uint8Array | null, tail: readonly Uint8Array[]): TailMerge {
  const doc = new Y.Doc();
  try {
    if (base) Y.applyUpdate(doc, base);
    for (const [i, update] of tail.entries()) {
      try {
        Y.applyUpdate(doc, update);
      } catch (error) {
        const name = error instanceof Error ? error.name : "Error";
        return { ok: false, reason: `tail update ${i} unmergeable: ${name}` };
      }
    }
    // Yjs parks updates whose dependencies are missing in the store instead of throwing.
    if (doc.store.pendingStructs !== null || doc.store.pendingDs !== null) {
      return { ok: false, reason: "tail has missing dependencies" };
    }
    return { ok: true, state: Y.encodeStateAsUpdate(doc) };
  } finally {
    doc.destroy();
  }
}
