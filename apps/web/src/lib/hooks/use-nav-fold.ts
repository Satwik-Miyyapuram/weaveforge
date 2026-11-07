"use client";

/**
 * Lets a screen that needs the whole window fold the app's sidebar to its icon
 * rail while it is up, as `/workspace` does by route. The live Overleaf editor
 * opens inside `/report` without a route of its own, so it claims the fold
 * instead. It only sets the default: the hamburger still unfolds the sidebar.
 */

import { useEffect, useSyncExternalStore } from "react";

let claims = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** True while any mounted screen claims the fold. */
export function navFoldSnapshot(): boolean {
  return claims > 0;
}

/** Fold the app nav while `active` and the caller is mounted. */
export function useFoldNav(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    claims += 1;
    emit();
    return () => {
      claims -= 1;
      emit();
    };
  }, [active]);
}

/** Read by the app shell: whether some screen wants the nav folded. */
export function useNavFolded(): boolean {
  return useSyncExternalStore(subscribe, navFoldSnapshot, () => false);
}
