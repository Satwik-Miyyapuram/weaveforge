"use client";

import { RouteError } from "../route-error";
import type { ErrorBoundaryProps } from "../error-boundary-parts";

/**
 * Vault (notes) boundary. The note editor mounts CodeMirror, the markdown
 * renderer and the collaborative binding, so it has more to go wrong than most
 * screens — and a crash there must not cost the reader their navigation.
 */
export default function NotesError(props: ErrorBoundaryProps) {
  return <RouteError scope="Notes" {...props} />;
}
