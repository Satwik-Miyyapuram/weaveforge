import { useCallback, useState } from "react";

import { readStored, writeStored } from "@/lib/safe-storage";
import { INK_PAGE_GAPS, type InkPageGap } from "./ink-bar-more";

const PAGE_GAP_KEY = "wf.ink.pageGap";

/** The note's page spacing, remembered per device like the dock is. */
export function readPageGap(): InkPageGap {
  const saved = readStored(PAGE_GAP_KEY);
  return (INK_PAGE_GAPS as readonly string[]).includes(saved ?? "") ? (saved as InkPageGap) : "none";
}

export function writePageGap(gap: InkPageGap) {
  writeStored(PAGE_GAP_KEY, gap);
}

/** The page spacing, and a setter that remembers the choice on this device. */
export function usePageGap(): [InkPageGap, (gap: InkPageGap) => void] {
  const [gap, setGap] = useState<InkPageGap>(readPageGap);
  const choose = useCallback((next: InkPageGap) => {
    setGap(next);
    writePageGap(next);
  }, []);
  return [gap, choose];
}
