"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useDismissOnOutside } from "@/lib/hooks/use-dismiss-on-outside";
import { ChevronIcon } from "./chevron-icon";

const VIEWPORT_PAD = 12;

/**
 * A button that opens an anchored panel (used for filters that we don't want
 * cluttering the page). Closes on outside click, Esc, or another open. The
 * optional `count` renders a small badge — handy for "N filters active".
 */
export function Popover({
  label,
  count,
  align = "left",
  ariaLabel,
  iconOnly = false,
  children,
}: {
  label: React.ReactNode;
  count?: number;
  align?: "left" | "right";
  /** Accessible name when `label` is an icon. */
  ariaLabel?: string;
  /** Compact icon trigger — hides the caret. */
  iconOnly?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [panelPos, setPanelPos] = useState<CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos({ visibility: "hidden" });
      return;
    }
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const place = () => {
      const tr = trigger.getBoundingClientRect();
      const pw = panel.offsetWidth;
      const ph = panel.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let left = align === "right" ? tr.right - pw : tr.left;
      left = Math.max(VIEWPORT_PAD, Math.min(left, vw - pw - VIEWPORT_PAD));

      let top = tr.bottom + 6;
      if (top + ph > vh - VIEWPORT_PAD) {
        const above = tr.top - ph - 6;
        if (above >= VIEWPORT_PAD) top = above;
      }

      setPanelPos({
        position: "fixed",
        top,
        left,
        right: "auto",
        zIndex: 60,
        visibility: "visible",
      });
    };

    // Measure off-screen first so the panel never flashes in document flow.
    setPanelPos({ position: "fixed", top: -9999, left: -9999, visibility: "hidden" });
    place();
    const ro = new ResizeObserver(place);
    ro.observe(panel);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align, children]);

  useDismissOnOutside(open, () => setOpen(false), ref);

  // Move focus into the panel on open; restore it to the trigger on close.
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(
      'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
    );
    (first ?? panel)?.focus();
    return () => trigger?.focus();
  }, [open]);

  return (
    <div className="popover" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className={`btn-secondary popover-trigger${open ? " on" : ""}${iconOnly ? " popover-trigger--icon" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        {count ? <span className="popover-badge">{count}</span> : null}
        {!iconOnly && <ChevronIcon open={open} className="popover-caret" />}
      </button>
      {open && (
        <div
          ref={panelRef}
          className="popover-panel card"
          id={panelId}
          role="dialog"
          aria-label={ariaLabel}
          tabIndex={-1}
          style={panelPos}
        >
          {children}
        </div>
      )}
    </div>
  );
}
