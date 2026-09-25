import { useCallback, useState } from "react";

import { INK_PAGE_GAPS, type InkPageGap } from "./ink-bar-more";

const PAGE_GAP_KEY = "wf.ink.pageGap";

/** The note's page spacing, remembered per device like the dock is. */
function readPageGap(): InkPageGap {
  try {
    const saved = window.localStorage.getItem(PAGE_GAP_KEY);
    return (INK_PAGE_GAPS as readonly string[]).includes(saved ?? "")
      ? (saved as InkPageGap)
      : "none";
  } catch {
    return "none";
  }
}

function writePageGap(gap: InkPageGap) {
  try {
    window.localStorage.setItem(PAGE_GAP_KEY, gap);
  } catch {
    // Blocked storage: the spacing lasts for this session only.
  }
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
