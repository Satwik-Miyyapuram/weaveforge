"use client";

import { useEffect } from "react";
import { THEME_CHANGE_EVENT } from "@/lib/theme-events";

/**
 * Pointer plumbing for the reactive animation layer.
 *
 * The layer itself is CSS (see the REACTIVE MOTION block in globals.css); all
 * this does is publish where the pointer is inside the surface under it, as
 * `--rx` / `--ry` in the 0–1 range, so the CSS can tilt a card toward the
 * cursor and put the sheen where the cursor is.
 *
 * Three deliberate constraints:
 *   - Nothing is attached at all unless the user turned reactive motion on and
 *     the OS is not asking for reduced motion. Off means zero listeners, not
 *     listeners that early-return.
 *   - One delegated `pointermove` on the document, coalesced into a single rAF.
 *     Per-card listeners on a long list is how this pattern becomes a jank
 *     source.
 *   - Coarse pointers (touch) are skipped: there is no hover state to track,
 *     and writing vars on every touch-drag frame is wasted work.
 */
/**
 * Surfaces that tilt and take a cursor sheen. Kept in lockstep with the
 * `[data-motion="reactive"]` block in globals.css — a selector here without a
 * rule there just writes two custom properties nobody reads, and a rule there
 * without a selector here silently never animates. `[data-reactive]` is the
 * opt-in escape hatch for anything not covered by a class.
 */
const REACTIVE_SURFACES =
  ".entity-card, .paper-card, .dashboard-card, .artifact-card, .org-choice-card, .integration-item, [data-reactive]";

export function ReactiveMotion() {
  useEffect(() => {
    let detach: (() => void) | null = null;

    function attach() {
      if (detach) return;
      const root = document.documentElement;
      let frame = 0;
      let pending: PointerEvent | null = null;
      let last: HTMLElement | null = null;

      const clear = (el: HTMLElement | null) => {
        if (!el) return;
        el.style.removeProperty("--rx");
        el.style.removeProperty("--ry");
      };

      const flush = () => {
        frame = 0;
        const event = pending;
        pending = null;
        if (!event) return;
        const target =
          (event.target as Element | null)?.closest<HTMLElement>(REACTIVE_SURFACES) ?? null;
        // The vars are deliberately *not* cleared when the pointer leaves.
        // Clearing them snaps the sheen back to the card's centre, and since
        // only opacity is transitioned that reads as the glow sliding inward
        // while it fades. Leaving the last position means it fades out where
        // the pointer actually was; the next hover overwrites it on the first
        // move event anyway, before the card is visible enough to notice.
        last = target;
        if (!target) return;
        const box = target.getBoundingClientRect();
        if (!box.width || !box.height) return;
        target.style.setProperty("--rx", ((event.clientX - box.left) / box.width).toFixed(3));
        target.style.setProperty("--ry", ((event.clientY - box.top) / box.height).toFixed(3));
      };

      const onMove = (event: PointerEvent) => {
        if (event.pointerType === "touch") return;
        pending = event;
        if (!frame) frame = requestAnimationFrame(flush);
      };

      const onLeave = () => {
        last = null;
      };

      document.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerleave", onLeave, { passive: true });
      root.dataset.reactivePointer = "on";

      detach = () => {
        if (frame) cancelAnimationFrame(frame);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerleave", onLeave);
        clear(last);
        delete root.dataset.reactivePointer;
        detach = null;
      };
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(pointer: fine)");

    const sync = () => {
      const on =
        document.documentElement.dataset.motion === "reactive" &&
        !reduced.matches &&
        fine.matches;
      if (on) attach();
      else detach?.();
    };

    sync();
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    reduced.addEventListener("change", sync);
    fine.addEventListener("change", sync);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      reduced.removeEventListener("change", sync);
      fine.removeEventListener("change", sync);
      detach?.();
    };
  }, []);

  return null;
}
