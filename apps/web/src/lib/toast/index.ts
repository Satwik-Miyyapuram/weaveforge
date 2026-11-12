"use client";

import { useSyncExternalStore } from "react";
import { type DeferredDelete, type ToastInput, toasts } from "./parts";

export type { DeferredDelete } from "./parts";

// --- index ---




/** A short note at the bottom of the screen: "Copied", "Note created · Open". */
export function showToast(message: string, action?: ToastInput["action"]): void {
  toasts.show({ message, action });
}

/** Hide now, delete when the Undo toast closes (rule D-07). */
export function deferDelete(input: DeferredDelete): void {
  toasts.deferDelete(input);
}

/** "‹Item› deleted", with a long name cut so the toast stays one line. */
export function deletedMessage(name: string, noun = ""): string {
  const clean = name.trim();
  if (!clean) return noun ? `${noun} deleted` : "Deleted";
  const short = clean.length > 48 ? `${clean.slice(0, 47)}…` : clean;
  return `"${short}" deleted`;
}

const subscribe = (fn: () => void) => toasts.subscribe(fn);
const hiddenNow = () => toasts.hiddenKeys();

/** Keys of items deleted but still undoable. Screens leave them out. */
export function useHiddenKeys(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, hiddenNow, hiddenNow);
}

// --- remove-later ---
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
