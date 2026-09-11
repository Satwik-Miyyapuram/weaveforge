/**
 * The status bar: what the document is, and whether it is saved.
 *
 * The screen deliberately has no save button — the editor debounces and writes
 * on its own — and until now nothing told the user whether what they just typed
 * had landed. `workspace-screen.tsx` was already counting in-flight saves for
 * the `beforeunload` guard; this is that number, said out loud.
 *
 * The per-kind decisions (which segments a kind gets) live in `kind.ts`, next
 * to the icon and suffix tables, so a new document kind fills in one row rather
 * than adding a branch here.
 */

import { CheckIcon } from "@/components/view-icons";

/**
 * What the save indicator says.
 *
 * Three states, in the order the user meets them: nothing typed yet, a write in
 * flight, and a change that has not reached a write. `saving` wins over
 * `unsaved` because while a write is in flight the answer to "is my work
 * safe?" is "it is being taken care of", not "no".
 */
export type SaveState = "saved" | "saving" | "unsaved";

export function saveState(state: { pending: number; dirty: boolean }): SaveState {
  if (state.pending > 0) return "saving";
  return state.dirty ? "unsaved" : "saved";
}

export function saveLabel(state: SaveState): string {
  if (state === "saving") return "Saving…";
  if (state === "unsaved") return "Unsaved";
  return "Saved";
}

/** The segments a document kind paints, in order. Empty for an unknown kind. */
export type SegmentKey =
  | "words"
  | "chars"
  | "cursor"
  | "encoding"
  | "language"
  | "branch"
  | "peers";

export function StatusBar({
  save,
  segments,
  values,
}: {
  save: SaveState;
  /** Which segments this kind shows — `segmentsFor(kind)` from `kind.ts`. */
  segments: readonly SegmentKey[];
  /** The value for each segment. A key with no value is not painted. */
  values: Partial<Record<SegmentKey, string>>;
}) {
  const shown = segments
    .map((key) => ({ key, value: values[key] }))
    .filter((segment): segment is { key: SegmentKey; value: string } => Boolean(segment.value));

  return (
    <footer
      className={`status-bar is-${save}`}
      aria-label="Document status"
      data-save={save}
    >
      <span className="status-bar-save" role="status">
        {save === "saved" ? (
          <CheckIcon className="status-bar-check" />
        ) : (
          // A dot rather than the check: the indicator has one glyph for "done"
          // and none for "in progress", and an animated spinner in a 26px strip
          // is noise. The text carries the state either way.
          <span className="status-bar-dot" aria-hidden="true" />
        )}
        {saveLabel(save)}
      </span>
      <span className="status-bar-spacer" />
      {shown.map(({ key, value }) => (
        <span className="status-bar-segment" key={key} data-segment={key}>
          {value}
        </span>
      ))}
    </footer>
  );
}
