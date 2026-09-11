"use client";

import { RouteError } from "../route-error";
import type { ErrorBoundaryProps } from "../error-boundary-parts";

/** Plan boundary — milestones, dependencies and the computed rollups. */
export default function PlanError(props: ErrorBoundaryProps) {
  return <RouteError scope="Plan" {...props} />;
}
