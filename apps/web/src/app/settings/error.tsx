"use client";

import { RouteError } from "../route-error";
import type { ErrorBoundaryProps } from "../error-boundary-parts";

/**
 * Settings boundary. Settings is a route a reader lands on precisely when
 * something else is misbehaving, so it must be the one screen that cannot be
 * lost to a failure in a panel it happens to render.
 */
export default function SettingsError(props: ErrorBoundaryProps) {
  return <RouteError scope="Settings" {...props} />;
}
