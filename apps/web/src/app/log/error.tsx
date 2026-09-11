"use client";

import { RouteError } from "../route-error";
import type { ErrorBoundaryProps } from "../error-boundary-parts";

/**
 * Logbook boundary — the daily diary, which is a write-heavy screen where an
 * unmount caused by an escalated error would cost the entry being typed.
 */
export default function LogError(props: ErrorBoundaryProps) {
  return <RouteError scope="Logbook" {...props} />;
}
