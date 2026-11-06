import type { TextComponent, TextOp } from "../domain/text-ot";

/** What the editor reports for one transaction: the same shape as CodeMirror's `ChangeSet.iterChanges`. */
export interface EditorChanges {
  iterChanges(f: (fromA: number, toA: number, fromB: number, toB: number, inserted: { toString(): string }) => void): void;
}

/** One sequential edit for the editor: replace `from..to` with `insert`. */
export type EditorChange = { from: number; to?: number; insert?: string };

/**
 * An editor transaction as an Overleaf op. The editor's ranges all refer to the
 * text before the transaction, so they are emitted from the end backwards: each
 * component then still applies at its own position.
 */
export function opFromChanges(changes: EditorChanges, before: string): TextOp {
  const ranges: { from: number; to: number; text: string }[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => ranges.push({ from: fromA, to: toA, text: inserted.toString() }));
  const op: TextOp = [];
  for (const range of ranges.reverse()) {
    if (range.to > range.from) op.push({ p: range.from, d: before.slice(range.from, range.to) });
    if (range.text) op.push({ p: range.from, i: range.text });
  }
  return op;
}

/** An Overleaf op as editor changes, to dispatch one after another. Comments change no text. */
export function changesFromOp(op: TextOp): EditorChange[] {
  const out: EditorChange[] = [];
  for (const c of op as TextComponent[]) {
    if ("i" in c) out.push({ from: c.p, insert: c.i });
    else if ("d" in c) out.push({ from: c.p, to: c.p + c.d.length });
  }
  return out;
}
