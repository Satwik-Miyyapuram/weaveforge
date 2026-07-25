"use client";

import { useEffect, useRef, useState } from "react";

import { DESKTOP_BREAKPOINT_PX } from "./breakpoints";

export type LayoutBreakpoint = "mobile" | "desktop";

/** Entrance animation when crossing the app-wide layout breakpoint. */
export type NavEnterAnim = "rise" | "slide" | null;

const MQ = `(min-width: ${DESKTOP_BREAKPOINT_PX}px)`;

function readBreakpoint(): LayoutBreakpoint {
  if (typeof window === "undefined") return "desktop";
  return window.matchMedia(MQ).matches ? "desktop" : "mobile";
}

/** Match --layout-duration in globals.css */
const LAYOUT_TRANSITION_MS = 320;

/**
 * Tracks mobile ↔ desktop breakpoint and fires a one-shot nav entrance
 * animation only when the user crosses the threshold (not on first paint).
 */
export function useLayoutBreakpoint() {
  const [breakpoint, setBreakpoint] = useState<LayoutBreakpoint>(readBreakpoint);
  const [navEnter, setNavEnter] = useState<NavEnterAnim>(null);
  const bpRef = useRef(breakpoint);
  const readyRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia(MQ);

    const apply = (next: LayoutBreakpoint, animate: boolean) => {
      if (next === bpRef.current) return;
      if (animate) {
        setNavEnter(next === "desktop" ? "slide" : "rise");
        window.setTimeout(() => setNavEnter(null), LAYOUT_TRANSITION_MS);
      }
      bpRef.current = next;
      setBreakpoint(next);
    };

    bpRef.current = mq.matches ? "desktop" : "mobile";
    setBreakpoint(bpRef.current);
    readyRef.current = true;

    const onChange = () => {
      if (!readyRef.current) return;
      apply(mq.matches ? "desktop" : "mobile", true);
    };

    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return { breakpoint, navEnter };
}

export function isDesktopBreakpoint(bp: LayoutBreakpoint): boolean {
  return bp === "desktop";
}

export type RglBreakpoint = "lg" | "sm";

export function getRglBreakpoint(): RglBreakpoint {
  if (typeof window === "undefined") return "lg";
  return window.innerWidth >= DESKTOP_BREAKPOINT_PX ? "lg" : "sm";
}
