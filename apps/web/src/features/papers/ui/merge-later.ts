import { toasts } from "@/lib/toast/toast-store";
import { paperKey } from "./remove-paper";

/** One duplicate merge under rule D-07. */
export interface MergeLater {
  keepId: string;
  ids: readonly string[];
  /** The real merge; runs when the Undo toast closes. */
  merge: () => Promise<unknown>;
  /** Runs after the merge, failed or not. */
  onMerged: () => void | Promise<void>;
}

/**
 * Hide the copies being merged away now and merge when the Undo toast closes.
 * Nothing changes before then, so Undo needs no stored previous state.
 */
export function mergeLater({ keepId, ids, merge, onMerged }: MergeLater): void {
  const gone = ids.filter((id) => id !== keepId);
  toasts.deferDelete({
    keys: gone.map(paperKey),
    message: gone.length === 1 ? "Duplicate merged" : `${gone.length} duplicates merged`,
    failure: "Could not merge",
    commit: async () => {
      try {
        await merge();
      } finally {
        await onMerged();
      }
    },
  });
}
