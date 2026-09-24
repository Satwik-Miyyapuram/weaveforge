"use client";

import { useEffect, useRef, useState } from "react";

import { DESKTOP_BREAKPOINT_PX, RAIL_COLLAPSE_BELOW_PX } from "@/lib/breakpoints";

export type LayoutBreakpoint = "mobile" | "desktop";

/** Entrance animation when crossing the app-wide layout breakpoint. */
export type NavEnterAnim = "rise" | "slide" | null;

const MQ = `(min-width: ${DESKTOP_BREAKPOINT_PX}px)`;

/**
 * The width below which the sidebar starts as the rail.
 *
 * A second query rather than a second breakpoint mode: nothing about the layout
 * *kind* changes here — the shell is desktop either way and the rail is the same
 * rail the hamburger toggles. Only the default state differs, so this is a
 * boolean beside `breakpoint`, not a third value of it.
 */
const RAIL_MQ = `(min-width: ${RAIL_COLLAPSE_BELOW_PX}px)`;

function readBreakpoint(): LayoutBreakpoint {
  if (typeof window === "undefined") return "desktop";
  return window.matchMedia(MQ).matches ? "desktop" : "mobile";
}

/**
 * Whether the sidebar should start collapsed here. False on the server, so the
 * wide sidebar is what a render without a window describes, matching
 * `readBreakpoint`'s "desktop" default.
 */
function readRailByDefault(): boolean {
  if (typeof window === "undefined") return false;
  return !window.matchMedia(RAIL_MQ).matches;
}

/** Match --layout-duration in styles/base.css */
const LAYOUT_TRANSITION_MS = 320;

/**
 * Tracks mobile ↔ desktop breakpoint and fires a one-shot nav entrance
 * animation only when the user crosses the threshold (not on first paint).
 */
export function useLayoutBreakpoint() {
  const [breakpoint, setBreakpoint] = useState<LayoutBreakpoint>(readBreakpoint);
  const [navEnter, setNavEnter] = useState<NavEnterAnim>(null);
  const [railByDefault, setRailByDefault] = useState<boolean>(readRailByDefault);
  const bpRef = useRef(breakpoint);
  const readyRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia(MQ);
    const railMq = window.matchMedia(RAIL_MQ);

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

    // No entrance animation for this one: collapsing to the rail is a change of
    // default state, not of layout kind, and it should simply be where the
    // window already is rather than something that animates in.
    const onRailChange = () => setRailByDefault(!railMq.matches);

    mq.addEventListener("change", onChange);
    railMq.addEventListener("change", onRailChange);
    return () => {
      mq.removeEventListener("change", onChange);
      railMq.removeEventListener("change", onRailChange);
    };
  }, []);

  return { breakpoint, navEnter, railByDefault };
}

export type RglBreakpoint = "lg" | "sm";

export function getRglBreakpoint(): RglBreakpoint {
  if (typeof window === "undefined") return "lg";
  return window.innerWidth >= DESKTOP_BREAKPOINT_PX ? "lg" : "sm";
}
