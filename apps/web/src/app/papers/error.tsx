"use client";

import { RouteError } from "../route-error";
import type { ErrorBoundaryProps } from "../error-boundary-parts";

/**
 * Papers boundary. The library list renders every card, its thumbnails and the
 * shared-paper projections, and it is where most sessions start — an error here
 * used to escalate straight to the app-level boundary.
 */
export default function PapersError(props: ErrorBoundaryProps) {
  return <RouteError scope="Papers" {...props} />;
}
