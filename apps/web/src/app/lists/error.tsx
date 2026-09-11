"use client";

import { RouteError } from "../route-error";
import type { ErrorBoundaryProps } from "../error-boundary-parts";

/** Reading lists boundary — screening, extraction tables and pin merging. */
export default function ListsError(props: ErrorBoundaryProps) {
  return <RouteError scope="Reading lists" {...props} />;
}
