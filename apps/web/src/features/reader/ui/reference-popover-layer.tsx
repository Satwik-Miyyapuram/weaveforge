"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useDismissOnOutside } from "@/lib/hooks/use-dismiss-on-outside";

const VIEWPORT_PAD = 12;
const GAP = 6;
/** Matches `--z-popover`'s intent in the reader's stacking order. */
const POPOVER_Z = 60;

/** The anchored box a popover was opened from, in viewport pixels. */
export interface AnchorBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PopoverLayerProps {
  /** Changing this re-places the panel — pass the mention's key. */
  anchorKey: string;
  /** The clicked mention's box in viewport pixels, or null for a keyboard open. */
  anchor: AnchorBox | null;
  onRequestClose: () => void;
  children: React.ReactNode;
}

/**
 * The mention's box right now, preferring the element the overlay painted so
 * the panel follows the text it describes instead of hanging where it was
 * clicked. Falls back to the box captured at open when the element is gone —
 * the page was re-rendered and this is a stale panel either way, but a correct
 * position beats a vanished one.
 */
function liveAnchor(key: string, fallback: AnchorBox): AnchorBox {
  const el = document.querySelector<HTMLElement>(
    `[data-mention-key="${CSS.escape(key)}"]`,
  );
  if (!el) return fallback;
  const rect = el.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/**
 * A popover pinned to a mention inside the page.
 *
 * The library `Popover` anchors to a trigger button it renders, which is no use
 * when the anchor is a box in the text layer. This is the same idea — fixed
 * position, measured off-screen first so it never flashes in flow, flipped above
 * the anchor when there is no room below, repositioned on resize — with a
 * rectangle as the origin, and it re-reads that rectangle on scroll so the panel
 * stays on the sentence it belongs to.
 *
 * Focus moves into the panel on open and returns to whatever had it on close.
 */
export function PopoverLayer({ anchorKey, anchor, onRequestClose, children }: PopoverLayerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (!anchor || anchor.width <= 0 || anchor.height <= 0) {
      // Without a box there is nothing to sit beside — a keyboard-invoked open
      // for a mention that did not render geometry. Leave the panel in the
      // accessibility tree rather than guessing a spot over unrelated text.
      setPos({ position: "fixed", top: -9999, left: -9999, visibility: "hidden" });
      return;
    }

    const place = () => {
      const box = liveAnchor(anchorKey, anchor);
      const pw = panel.offsetWidth;
      const ph = panel.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let left = box.left + box.width / 2 - pw / 2;
      left = Math.max(VIEWPORT_PAD, Math.min(left, vw - pw - VIEWPORT_PAD));

      let top = box.top + box.height + GAP;
      if (top + ph > vh - VIEWPORT_PAD) {
        const above = box.top - ph - GAP;
        if (above >= VIEWPORT_PAD) top = above;
      }
      setPos({ position: "fixed", top, left, right: "auto", zIndex: POPOVER_Z, visibility: "visible" });
    };

    // Measure off-screen so the panel never flashes in document flow.
    setPos({ position: "fixed", top: -9999, left: -9999, visibility: "hidden" });
    place();
    const ro = new ResizeObserver(place);
    ro.observe(panel);
    window.addEventListener("resize", place);
    // Capture phase: the reader scrolls an inner element, not the window.
    window.addEventListener("scroll", place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorKey, anchor]);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(
      'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
    );
    (first ?? panel)?.focus();
    return () => restoreRef.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onRequestClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onRequestClose]);

  useDismissOnOutside(true, onRequestClose, panelRef);

  const close = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      onRequestClose();
    },
    [onRequestClose],
  );

  return (
    <div
      ref={panelRef}
      className="pdf-reader-ref-popover card"
      role="dialog"
      aria-label="Reference"
      tabIndex={-1}
      style={pos}
      data-popover="reference"
    >
      {children}
    </div>
  );
}