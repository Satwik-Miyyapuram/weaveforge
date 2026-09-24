"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
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
  triggerClassName = "btn-secondary",
  portal = false,
  children,
}: {
  label: React.ReactNode;
  count?: number;
  align?: "left" | "right";
  /** Accessible name when `label` is an icon. */
  ariaLabel?: string;
  /** Compact icon trigger — hides the caret. */
  iconOnly?: boolean;
  /** Extra class on the trigger, for a trigger that is a swatch rather than a button. */
  triggerClassName?: string;
  /**
   * Render the panel into `<body>` instead of under the trigger.
   *
   * The panel is positioned `fixed` in viewport coordinates, but a `fixed`
   * element is placed against its nearest ancestor that establishes a containing
   * block — any transform, filter, backdrop-filter, perspective or `contain`.
   * A trigger inside an animating card therefore pins the panel to *the card*,
   * and it opens offset from the button that was pressed. Portalling takes the
   * panel out of that subtree so `fixed` means the viewport again.
   *
   * Off by default: a trigger in static chrome (a toolbar) has no such ancestor,
   * and leaving the panel where it is keeps the DOM next to the control.
   */
  portal?: boolean;
  /** The panel, or a function of `close` when picking something should shut it. */
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
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

  // A portalled panel is outside `ref`, so it has to be named as "inside" too —
  // otherwise the mousedown that lands on an option closes the menu before the
  // click can select it. `useDismissOnOutside` takes a list for this.
  useDismissOnOutside(open, () => setOpen(false), portal ? [ref, panelRef] : ref);

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
        className={`${triggerClassName} popover-trigger${open ? " on" : ""}${iconOnly ? " popover-trigger--icon" : ""}`}
        aria-label={ariaLabel}
        // An icon has no words of its own; the tooltip gives the pointer the name a screen reader gets.
        title={iconOnly ? ariaLabel : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        {count ? <span className="popover-badge">{count}</span> : null}
        {!iconOnly && <ChevronIcon open={open} className="popover-caret" />}
      </button>
      {open &&
        (() => {
          const panel = (
            <div
              ref={panelRef}
              className="popover-panel card"
              id={panelId}
              role="dialog"
              aria-label={ariaLabel}
              tabIndex={-1}
              style={panelPos}
            >
              {typeof children === "function" ? children(() => setOpen(false)) : children}
            </div>
          );
          // `document.body` is safe here: the panel only exists once `open`, and
          // open is false in any server render.
          return portal ? createPortal(panel, document.body) : panel;
        })()}
    </div>
  );
}
