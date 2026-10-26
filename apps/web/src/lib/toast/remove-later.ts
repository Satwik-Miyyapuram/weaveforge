import { toasts } from "./toast-store";

/** One delete or unpin under rule D-07. */
export interface RemoveLater {
  /** The key screens hide while the Undo toast shows. */
  key: string;
  message: string;
  /** The real delete; runs when the toast closes. */
  remove: () => Promise<unknown>;
  /** Runs at once, e.g. leave the page of the deleted item. */
  onHidden?: () => void;
  /** Runs after the delete, failed or not: reload, never close what is open. */
  onDeleted?: () => void;
}

/** Hide an item now and delete it when its Undo toast closes (rule D-07). */
export function removeLater({ key, message, remove, onHidden, onDeleted }: RemoveLater): void {
  toasts.deferDelete({
    keys: [key],
    message,
    commit: async () => {
      try {
        await remove();
      } finally {
        onDeleted?.();
      }
    },
  });
  onHidden?.();
}
