"use client";

import { useSyncExternalStore } from "react";

import { toasts, type DeferredDelete, type ToastInput } from "./toast-store";

export { TOAST_MS, type DeferredDelete } from "./toast-store";
export { removeLater, type RemoveLater } from "./remove-later";

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
