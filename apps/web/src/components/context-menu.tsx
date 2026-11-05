"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";

import { Menu, type MenuItem } from "./menu";
import {
  CARD_SELECTOR,
  closeContextMenu,
  contextMenuState,
  isEditableTarget,
  openContextMenu,
  placeContextMenu,
  subscribeContextMenu,
} from "./context-menu-store";
import { useDismissOnOutside } from "@/lib/hooks/use-dismiss-on-outside";

/** Draws the right-click menu (`context-menu-store`). Mount once, in the app shell. */
export function ContextMenuHost() {
  const state = useSyncExternalStore(subscribeContextMenu, contextMenuState, () => null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const open = state !== null;

  useDismissOnOutside(open, closeContextMenu, panelRef);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!state || !panel) {
      setPlace(null);
      return;
    }
    const box = panel.getBoundingClientRect();
    setPlace(placeContextMenu(state.x, state.y, box.width, box.height, window.innerWidth, window.innerHeight));
    panel.querySelector<HTMLButtonElement>("button.wf-item:not(:disabled)")?.focus({ preventScroll: true });
  }, [state]);

  useEffect(() => {
    if (!open) return;
    // The menu points at what was under the pointer; once that moves it is stale.
    const close = () => closeContextMenu();
    window.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (!state || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef}
      className="popover-panel card context-menu"
      style={{
        position: "fixed",
        left: place?.left ?? state.x,
        top: place?.top ?? state.y,
        zIndex: 1000,
        visibility: place ? "visible" : "hidden",
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <Menu items={state.items} onClose={closeContextMenu} ariaLabel="Context menu" />
    </div>,
    document.body,
  );
}

/**
 * Right-click on the card around `anchor` opens `items`. Items are read at
 * click time, so they can change every render without re-binding.
 */
export function useCardContextMenu(anchor: RefObject<HTMLElement | null>, items: readonly MenuItem[]): void {
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Re-bind when the anchor appears or goes: a menu with no items renders none.
  const hasItems = items.length > 0;
  useEffect(() => {
    if (!hasItems) return;
    const card = anchor.current?.closest<HTMLElement>(CARD_SELECTOR);
    if (!card) return;
    const onMenu = (event: MouseEvent) => {
      // An inner surface (an editor, a nested card) already handled it.
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      openContextMenu(event, itemsRef.current);
    };
    card.addEventListener("contextmenu", onMenu);
    return () => card.removeEventListener("contextmenu", onMenu);
  }, [anchor, hasItems]);
}
