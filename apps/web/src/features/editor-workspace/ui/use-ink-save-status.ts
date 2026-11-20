import { useSyncExternalStore } from "react";

import { getInkSaveStatus, subscribeInkSaveStatus } from "@/features/ink/application/parts";

/**
 * Ink saves run outside the workspace screen's counters: a stroke's debounce and its
 * write count as pending, and a failed ink write counts as dirty.
 */
export function useInkSaveStatus() {
  return useSyncExternalStore(subscribeInkSaveStatus, getInkSaveStatus, getInkSaveStatus);
}
