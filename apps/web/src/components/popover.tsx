"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useDismissOnOutside } from "@/lib/hooks/use-dismiss-on-outside";
import { Button, IconButton } from "./button";
import { ChevronIcon } from "./chevron-icon";
import { ComboboxButton, Swatch } from "./controls";
import { focusFirstControl, focusFirstField } from "./modal";
import { VIEWPORT_PAD } from "./viewport-pad";
/** What the trigger is drawn as; each maps to one button primitive. */
type Trigger = "button" | "icon" | "swatch" | "select";

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
  trigger = "button",
  caret = true,
  colour,
  portal = false,
  disabled = false,
  children,
}: {
  label: React.ReactNode;
  count?: number;
  align?: "left" | "right";
  /** Accessible name when `label` is an icon. */
  ariaLabel?: string;
  /**
   * What the trigger is drawn as: a secondary `button` with a caret, a square
   * `icon` button, a colour `swatch` (painted with `colour`), or a `select`
   * field. The icon and swatch take their name from `ariaLabel`.
   */
  trigger?: Trigger;
  /**
   * The `button` trigger's caret. Off for a button whose label is only an icon:
   * it is named and tipped by `ariaLabel` instead.
   */
  caret?: boolean;
  /** The swatch trigger's colour. */
  colour?: string;
  /** Greys the trigger; the panel cannot open. */
  disabled?: boolean;
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
  const openedByPointer = useRef(false);
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
        // Portalled panels can open from inside a modal, so they stack above it.
        zIndex: portal ? "var(--z-menu)" : "var(--z-popover)",
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
    // `children` is left out on purpose: it is a new value on every parent
    // render, and the ResizeObserver already re-places when the content resizes.
  }, [open, align, portal]);

  // A portalled panel is outside `ref`, so it has to be named as "inside" too —
  // otherwise the mousedown that lands on an option closes the menu before the
  // click can select it. `useDismissOnOutside` takes a list for this.
  useDismissOnOutside(open, () => setOpen(false), portal ? [ref, panelRef] : ref);

  // Focus once placed: a visibility:hidden panel ignores focus(). Restore to the trigger on close.
  const shown = open && panelPos.visibility === "visible";
  useEffect(() => {
    if (!shown) return;
    const trigger = triggerRef.current;
    // A click leaves focus on the panel so no row wears the keyboard ring; a key
    // press enters the row marked `data-autofocus` (the current choice), else the first.
    const marked = openedByPointer.current ? null : panelRef.current?.querySelector<HTMLElement>("[data-autofocus]");
    if (marked) marked.focus();
    else focusFirstField(panelRef.current, { buttons: !openedByPointer.current });
    return () => trigger?.focus();
  }, [shown]);

  // Shared by every trigger; the open state is `aria-expanded`.
  const opens = {
    ref: triggerRef,
    "aria-haspopup": "dialog" as const,
    "aria-controls": panelId,
    disabled,
    onClick: (e: React.MouseEvent) => {
      openedByPointer.current = e.detail > 0;
      setOpen((v) => !v);
    },
  };
  const badge = count ? <span className="popover-badge">{count}</span> : null;
  // An icon or swatch has no words of its own; the primitive gives it a tooltip from `ariaLabel`.
  const triggerButton =
    trigger === "icon" ? (
      <IconButton {...opens} aria-expanded={open} label={ariaLabel ?? ""}>
        {label}
        {badge}
      </IconButton>
    ) : trigger === "swatch" ? (
      <Swatch {...opens} aria-expanded={open} label={ariaLabel ?? ""} colour={colour}>
        {label}
        {badge}
      </Swatch>
    ) : trigger === "select" ? (
      <ComboboxButton {...opens} expanded={open} aria-label={ariaLabel}>
        {label}
        {badge}
      </ComboboxButton>
    ) : (
      <Button {...opens} aria-expanded={open} aria-label={ariaLabel} title={caret ? undefined : ariaLabel}>
        {label}
        {badge}
        {caret && <ChevronIcon open={open} className="popover-caret" />}
      </Button>
    );
  return (
    <div className="popover" ref={ref}>
      {triggerButton}
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
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                  e.preventDefault();
                  focusFirstControl(e.currentTarget);
                }
              }}
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
