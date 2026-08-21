"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { THEME_CHANGE_EVENT } from "@/lib/theme/theme-events";

export function useScrollSteps(count: number) {
  const sceneRef = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    let frame = 0;

    const resolve = () => {
      frame = 0;
      const steps = [...scene.querySelectorAll<HTMLElement>("[data-step]")];
      const stage = scene.querySelector<HTMLElement>("[data-stage]");
      if (!steps.length) return;

      // Detect the layout horizontally, not vertically. Comparing tops says
      // "stacked" on a wide screen too, because the sticky stage pins to the
      // top of the viewport while the first step still starts below it.
      // Whether the two share a column is the actual question — and when they
      // do, the middle of the viewport is behind the panel.
      let top = 0;
      if (stage) {
        const sr = stage.getBoundingClientRect();
        const fr = steps[0]!.getBoundingClientRect();
        const sideBySide = sr.right <= fr.left + 1 || fr.right <= sr.left + 1;
        if (!sideBySide) top = Math.max(sr.bottom, 0);
      }
      const line = top + (window.innerHeight - top) / 2;

      let best = 0, bestD = Infinity;
      steps.forEach((s, n) => {
        const r = s.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - line);
        if (d < bestD) { bestD = d; best = n; }

        // Stacked only: fade a step out before it reaches the pinned panel,
        // so nothing is ever legible through the visual. Driven from the
        // panel's live bottom edge because that varies per scene — the
        // reader's annotation panel is 200px taller than the shortest one,
        // and any single fixed distance leaves one scene or the other wrong.
        if (top > 0) {
          // Measured from the words, not from the box around them. A step is
          // half a screen tall with its text centred in it, so its box top is
          // a couple of hundred pixels above the first line — fading on that
          // faded the step being read down to nothing while its text sat in
          // clear space well below the panel.
          //
          // The band is the step's own first 44px of travel *under* the panel,
          // not a stretch of clear space below it: a step whose first line has
          // not reached the panel yet has nothing behind anything and is fully
          // opaque. On a short phone the readable band is barely taller than a
          // step, so any fade that starts below the panel edge dims the step
          // being read — which is the one thing it must never do.
          const ink = s.firstElementChild?.getBoundingClientRect().top ?? r.top;
          const fadeTo = top - 40;  // gone by the time it is properly behind
          const fadeFrom = top + 4; // full strength the moment it is clear
          const t = (ink - fadeTo) / (fadeFrom - fadeTo);
          s.style.opacity = String(Math.max(0, Math.min(1, t)));
        } else if (s.style.opacity) {
          // Side by side, nothing passes behind: hand opacity back to the CSS
          // that dims the inactive steps.
          s.style.removeProperty("opacity");
        }
      });
      setActive(best);
    };

    const onScroll = () => { if (!frame) frame = requestAnimationFrame(resolve); };
    // Capture phase on the document rather than the window, so this keeps
    // working if any ancestor ever becomes the scroller again.
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onScroll, { passive: true });
    resolve();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
    };
  }, [count]);

  return { sceneRef, active };
}

export function useCursorGlow() {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.motion;
    root.dataset.motion = "reactive";
    // <ReactiveMotion> is a child, and React runs child effects before the
    // parent's — so it has already decided motion was off by the time this
    // line runs. Tell it to look again, or the card sheen never attaches.
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(pointer: fine)");
    let frame = 0;
    let pending: PointerEvent | null = null;

    const flush = () => {
      frame = 0;
      const e = pending;
      pending = null;
      if (!e) return;
      root.style.setProperty("--gx", `${e.clientX.toFixed(0)}px`);
      root.style.setProperty("--gy", `${e.clientY.toFixed(0)}px`);
      root.style.setProperty("--g-on", "1");
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      pending = e;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const onLeave = () => root.style.setProperty("--g-on", "0");

    const on = () => !reduced.matches && fine.matches;
    if (on()) {
      document.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerleave", onLeave, { passive: true });
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      root.style.removeProperty("--gx");
      root.style.removeProperty("--gy");
      root.style.removeProperty("--g-on");
      if (previous) root.dataset.motion = previous;
      else delete root.dataset.motion;
    };
  }, []);
}
