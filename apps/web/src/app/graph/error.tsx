"use client";

import { RouteError } from "../route-error";
import type { ErrorBoundaryProps } from "../error-boundary-parts";

/** Graph boundary — the force simulation, its canvas and the graph side panel. */
export default function GraphError(props: ErrorBoundaryProps) {
  return <RouteError scope="Graph" {...props} />;
}
