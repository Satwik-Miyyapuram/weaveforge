"use client";

import { StateEffect, StateField, EditorSelection } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/**
 * Text that is standing in for something still being fetched.
 *
 * Three features need the same thing: an image upload, a picture being
 * downloaded from a URL, and a link waiting for its title. Each puts something
 * in the note straight away and replaces it a second or two later, and in the
 * meantime the writer keeps typing — in front of it, behind it, over it, or
 * pressing undo.
 *
 * So a remembered offset is wrong the moment anyone touches the keyboard. The
 * position lives in a state field instead, and CodeMirror maps it through every
 * change that happens in between. The `assoc` arguments are the part worth
 * reading twice: both point outward, so text typed at either edge stays outside
 * the region. Pointing them inward makes the region swallow whatever was typed
 * next, and the replacement then deletes it.
 */

export interface PendingRegion {
  id: number;
  from: number;
  to: number;
}

let nextId = 0;

const addPending = StateEffect.define<PendingRegion>();
const dropPending = StateEffect.define<number>();

/** Dims a region so it reads as "not yet part of the note". */
const PENDING_MARK = Decoration.mark({ class: "cm-pending-insert" });

const decorated = new Set<number>();

export const pendingInserts = StateField.define<PendingRegion[]>({
  create: () => [],
  update(current, tr) {
    let next = current;
    if (tr.docChanged) {
      next = next.map((region) => ({
        id: region.id,
        from: tr.changes.mapPos(region.from, 1),
        to: tr.changes.mapPos(region.to, -1),
      }));
    }
    for (const effect of tr.effects) {
      if (effect.is(addPending)) next = [...next, effect.value];
      else if (effect.is(dropPending)) next = next.filter((region) => region.id !== effect.value);
    }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (list) => {
      const marks = list.filter((region) => region.to > region.from && decorated.has(region.id));
      return marks.length === 0
        ? Decoration.none
        : (Decoration.set(
            marks.map((region) => PENDING_MARK.range(region.from, region.to)),
            true,
          ) as DecorationSet);
    }),
});

export const pendingTheme = EditorView.baseTheme({
  ".cm-pending-insert": { opacity: "0.55", fontStyle: "italic" },
});

/**
 * Replaces the selection with `text` and starts tracking where it went.
 *
 * `dim` decides whether it also reads as pending. A placeholder should; a URL
 * that is already usable while its title is fetched should not — the whole
 * point of pasting it immediately is that it works straight away.
 */
export function insertPending(view: EditorView, text: string, { dim = true } = {}): number {
  const id = ++nextId;
  const range = view.state.selection.main;
  const from = range.from;
  if (dim) decorated.add(id);

  view.dispatch({
    changes: { from, to: range.to, insert: text },
    selection: EditorSelection.cursor(from + text.length),
    effects: addPending.of({ id, from, to: from + text.length }),
    userEvent: "input.paste",
  });
  return id;
}

/** Starts tracking a region that is already in the document. */
export function trackPending(view: EditorView, from: number, to: number, { dim = false } = {}): number {
  const id = ++nextId;
  if (dim) decorated.add(id);
  view.dispatch({ effects: addPending.of({ id, from, to }) });
  return id;
}

/**
 * Swaps a tracked region for what finally arrived, wherever it has drifted to.
 *
 * Two ways there is nothing to swap, and both mean the same thing. The view may
 * have been torn down — the note closed, the screen navigated away. Or the
 * region may have collapsed to nothing because the writer deleted it, which is
 * exactly what pressing undo straight after a paste does: whatever arrived is
 * deliberately not put back, since content appearing in a note somebody has
 * just cleared is worse than a fetch nobody used.
 */
export function resolvePending(view: EditorView, id: number, replacement: string): void {
  decorated.delete(id);
  const region = view.state.field(pendingInserts, false)?.find((entry) => entry.id === id);
  if (!region) return;
  if (region.to <= region.from) {
    view.dispatch({ effects: dropPending.of(id) });
    return;
  }

  view.dispatch({
    changes: { from: region.from, to: region.to, insert: replacement },
    effects: dropPending.of(id),
    // Moved only when the caret is still where the region ended; a writer who
    // has moved on keeps their place.
    selection:
      view.state.selection.main.head === region.to
        ? EditorSelection.cursor(region.from + replacement.length)
        : undefined,
    userEvent: "input.paste",
  });
}

/** The extensions the machinery needs. */
export const pendingInsertSupport = [pendingInserts, pendingTheme];
