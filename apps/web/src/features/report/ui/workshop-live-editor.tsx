"use client";

import { useEffect, useRef, useState } from "react";
import { FormError } from "@/components/form-error";
import { workshopHttpForward } from "@/features/overleaf/infrastructure/workshop-http-forward";
import { workshopLiveTransport } from "@/features/overleaf/infrastructure/workshop-live-transport";
import type { WorkshopClientDeps } from "@/features/overleaf/infrastructure/workshop-session-client";

type Props = {
  client: WorkshopClientDeps;
  sessionId: string;
  projectId: string;
};

/**
 * Overleaf's own IDE (vendored, `vendor/overleaf`), mounted on one project.
 * The IDE talks to Overleaf through the workshop's live routes.
 */
export function WorkshopLiveEditor({ client, sessionId, projectId }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let unmount: (() => void) | null = null;
    let cancelled = false;
    setError(null);
    import("@overleaf-ide")
      .then(({ mountOverleafIde }) =>
        mountOverleafIde(container, {
          projectId,
          transport: workshopLiveTransport(client, sessionId, projectId),
          forward: workshopHttpForward(client, sessionId, projectId),
        }),
      )
      .then((stop) => {
        if (cancelled) stop();
        else unmount = stop;
      })
      .catch(() => {
        if (!cancelled) setError("The editor could not load. Reload the page to try again.");
      });
    return () => {
      cancelled = true;
      unmount?.();
    };
  }, [client, sessionId, projectId]);

  return (
    <>
      {error && <FormError>{error}</FormError>}
      <div ref={ref} className="workshop-ide" />
    </>
  );
}
