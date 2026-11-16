import { useEffect, useState } from "react";
import { useScreenActive } from "./use-screen-active";

/**
 * How long a screen stays hidden behind another before its heavy parts are let go.
 * Quick hops away and back stay instant; a screen left for a minute gives its
 * memory back and repaints what is in view when it returns.
 */
export const HIDDEN_RELEASE_MS = 60_000;

/**
 * Whether the screen around a component has been hidden (`useScreenActive`) for
 * `delayMs`. True means: free what can be rebuilt (painted pages, caches). It is
 * false again as soon as the screen is shown.
 */
export function useReleasedWhileHidden(delayMs: number = HIDDEN_RELEASE_MS): boolean {
  const active = useScreenActive();
  const [released, setReleased] = useState(false);
  useEffect(() => {
    if (active) return;
    const timer = setTimeout(() => setReleased(true), delayMs);
    return () => {
      clearTimeout(timer);
      setReleased(false);
    };
  }, [active, delayMs]);
  return released && !active;
}
