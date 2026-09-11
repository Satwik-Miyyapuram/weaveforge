"use client";

import { RouteError } from "./route-error";
import type { ErrorBoundaryProps } from "./error-boundary-parts";

/**
 * Root route boundary — catches whatever no closer segment boundary caught.
 *
 * Everything it shows lives in `route-error.tsx`, which every per-segment
 * `error.tsx` also renders; the difference is only the label. This one does not
 * name a screen, because by the time a failure reaches here the screen is not
 * known to be at fault — the shell itself may be.
 */
export default function Error(props: ErrorBoundaryProps) {
  return <RouteError {...props} />;
}
