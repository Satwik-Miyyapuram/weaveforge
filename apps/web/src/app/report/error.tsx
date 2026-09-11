"use client";

import { RouteError } from "../route-error";
import type { ErrorBoundaryProps } from "../error-boundary-parts";

/**
 * Report boundary — the section tree, the markdown editor and the Overleaf
 * link panel, all of which load data the writer is mid-edit on. Also covers
 * `/report/overleaf`.
 */
export default function ReportError(props: ErrorBoundaryProps) {
  return <RouteError scope="Report" {...props} />;
}
