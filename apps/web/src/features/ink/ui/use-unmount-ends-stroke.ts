import { useEffect, useRef } from "react";

/**
 * Unmount, in order: the in-progress stroke ends first, then the store's last
 * flush posts the save, then the pen disposes the worker. Effects clean up in
 * declaration order, so the host calls this before the store's and the pen's
 * hooks. A save posted after the pen has gone would queue and never send.
 *
 * The host points `endStrokeRef` at the pen's stroke end; `unmountedRef` says
 * the host is gone.
 */
export function useUnmountEndsStroke() {
  const endStrokeRef = useRef<() => void>(() => {});
  const unmountedRef = useRef(false);
  useEffect(() => {
    // Reset on mount: Strict Mode runs this cleanup and then mounts again.
    unmountedRef.current = false;
    return () => {
      // The latest stroke end is the point: the pen re-points it every render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      endStrokeRef.current();
      unmountedRef.current = true;
    };
  }, []);
  return { endStrokeRef, unmountedRef };
}
