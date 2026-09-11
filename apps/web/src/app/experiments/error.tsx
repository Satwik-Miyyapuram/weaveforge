"use client";

import { RouteError } from "../route-error";
import type { ErrorBoundaryProps } from "../error-boundary-parts";

/**
 * Experiments boundary. Covers `/experiments/[id]` too: the detail segment has
 * no boundary of its own, so a chart or metric-history failure on one run lands
 * here rather than at the app level.
 */
export default function ExperimentsError(props: ErrorBoundaryProps) {
  return <RouteError scope="Experiments" {...props} />;
}
