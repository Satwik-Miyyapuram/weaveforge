"use client";

import dynamic from "next/dynamic";

/**
 * The report panel, behind a lazy boundary — and here that is not only about size.
 *
 * `route-error.tsx` is the last thing standing when a module fails to load, and it
 * documents that it depends on nothing but its two siblings for exactly that
 * reason: if the thing that failed is a module the error screen also imports, the
 * screen never renders and the reader gets a blank page instead of an explanation.
 *
 * The panel needs the container (for the access token), and the container pulls in
 * most of the app. So the import is dynamic: the boundary renders its buttons and
 * its detail block regardless, and the report affordance appears if and when its
 * own chunk loads. A failed chunk costs the button, not the screen.
 */
const LazyPanel = dynamic(() => import("./error-report-panel").then((m) => m.ErrorReportPanel), {
  ssr: false,
});

export function ErrorReportPanel(props: { title: string; detail: string; route?: string }) {
  return <LazyPanel {...props} />;
}
