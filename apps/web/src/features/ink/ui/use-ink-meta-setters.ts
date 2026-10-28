import { useCallback, type MutableRefObject } from "react";
import type { InkHand, InkNoteMeta, InkPaper } from "@weaveforge/core";

import type { InkStoredPage } from "../application/ink-chunk-store";

export interface InkMetaSettersDeps {
  /** The header, as it will be written back. */
  metaRef: MutableRefObject<InkNoteMeta>;
  /** The pages loaded so far, or null before the sidecar answers. */
  pagesRef: MutableRefObject<InkStoredPage[] | null>;
  setHandState: (next: InkHand) => void;
  setPaperState: (next: InkPaper) => void;
  scheduleSave: () => void;
}

/**
 * The paper and the hand are the note's: changing either is a save.
 *
 * The paper is the note's too (§6.2.12): every stored page carries a copy,
 * so the pages already loaded take the new one before the sheet re-renders.
 * The hand (§4.1) lives only in the header.
 */
export function useInkMetaSetters({
  metaRef,
  pagesRef,
  setHandState,
  setPaperState,
  scheduleSave,
}: InkMetaSettersDeps) {
  const setPaper = useCallback(
    (next: InkPaper) => {
      metaRef.current = { ...metaRef.current, paper: next };
      pagesRef.current?.forEach((stored) => Object.assign(stored, { paper: next }));
      setPaperState(next);
      scheduleSave();
    },
    [metaRef, pagesRef, setPaperState, scheduleSave],
  );
  const setHand = useCallback(
    (next: InkHand) => {
      metaRef.current = { ...metaRef.current, hand: next };
      setHandState(next);
      scheduleSave();
    },
    [metaRef, setHandState, scheduleSave],
  );
  return { setPaper, setHand };
}
