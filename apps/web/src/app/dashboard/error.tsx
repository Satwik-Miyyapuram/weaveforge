"use client";

import { RouteError } from "../route-error";
import type { ErrorBoundaryProps } from "../error-boundary-parts";

/**
 * Dashboard boundary. The dashboard is the landing route and the widest screen
 * in the app — a dozen aggregated panels, several of them charts — so it is the
 * single most likely place for one panel's render error to take the whole shell
 * down. Caught here, the failure is contained to this route.
 */
export default function DashboardError(props: ErrorBoundaryProps) {
  return <RouteError scope="Dashboard" {...props} />;
}
