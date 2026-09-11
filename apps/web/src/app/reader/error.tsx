"use client";

import { RouteError } from "../route-error";
import type { ErrorBoundaryProps } from "../error-boundary-parts";

/**
 * Reader boundary. The PDF reader is the largest and most failure-prone screen
 * in the app — pdf.js, canvas rendering, the annotation overlay and the
 * text-layer indexer all run here — and it is where the reader is most likely
 * to be mid-task when something throws.
 */
export default function ReaderError(props: ErrorBoundaryProps) {
  return <RouteError scope="Reader" {...props} />;
}
