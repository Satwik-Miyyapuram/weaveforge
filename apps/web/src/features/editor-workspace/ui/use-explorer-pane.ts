"use client";

import { useCallback, useEffect, useState } from "react";

import { DESKTOP_BREAKPOINT_PX } from "@/lib/parts";
import { EXPLORER_WIDTH_DEFAULT, readExplorerWidth, readHidden, writeExplorerWidth, writeHidden } from "../application/parts";
import { store } from "./workspace-screen-support";

/** Whether the explorer shows, how wide it is, and its drawer form on a phone. */
export function useExplorerPane(hasOpenTab: boolean) {
  const [explorerHidden, setExplorerHidden] = useState(false);
  useEffect(() => setExplorerHidden(readHidden(store())), []);
  // The explorer's dragged width, per device like `hidden`.
  const [explorerWidth, setExplorerWidth] = useState(EXPLORER_WIDTH_DEFAULT);
  useEffect(() => setExplorerWidth(readExplorerWidth(store())), []);
  const keepExplorerWidth = useCallback((width: number) => writeExplorerWidth(store(), width), []);
  // On a phone there is no room for the explorer beside a document: at 375px
  // the two shared the width, the tree's labels truncated to a letter and the
  // PDF's own toolbar sat over the page. There the explorer is a drawer over
  // the document, closed once something is opened from it, and its state is
  // not written back — a phone closing it must not hide it on the desktop.
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${DESKTOP_BREAKPOINT_PX - 1}px)`);
    const sync = () => setPhone(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (phone && hasOpenTab) setExplorerHidden(true);
    // Only when the width crosses, or the first document arrives: the drawer
    // stays where the person put it after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, hasOpenTab]);
  const toggleExplorer = useCallback(() => {
    setExplorerHidden((current) => {
      if (!phone) writeHidden(store(), !current);
      return !current;
    });
  }, [phone]);
  return { phone, explorerHidden, setExplorerHidden, toggleExplorer, explorerWidth, setExplorerWidth, keepExplorerWidth };
}
