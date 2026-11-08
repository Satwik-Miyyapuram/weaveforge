"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FormError } from "@/components/form-error";
import { ToolbarSlot } from "@/components/toolbar-slot";
import { workshopHttpForward } from "@/features/overleaf/infrastructure/workshop-http-forward";
import { workshopLiveTransport } from "@/features/overleaf/infrastructure/workshop-live-transport";
import type { WorkshopClientDeps } from "@/features/overleaf/infrastructure/workshop-session-client";

type Props = {
  client: WorkshopClientDeps;
  sessionId: string;
  projectId: string;
  /** Host buttons shown first in Overleaf's toolbar actions. */
  toolbar: ReactNode;
  /** Overleaf's home button: back to the project list. */
  onHome: () => void;
};

/** Overleaf's toolbar, rendered by the IDE once the project has joined. */
const ACTIONS = ".ide-redesign-toolbar-actions";
const HOME = "a.ide-redesign-toolbar-home-link";

/**
 * Overleaf's own IDE (vendored, `vendor/overleaf`), mounted on one project.
 * The IDE talks to Overleaf through the workshop's live routes.
 */
export function WorkshopLiveEditor({ client, sessionId, projectId, toolbar, onHome }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // Overleaf's top bar goes up into the workspace toolbar row, so the tabs above never move.
  const [bar, setBar] = useState<HTMLElement | null>(null);
  const home = useRef(onHome);
  home.current = onHome;

  // A slot at the start of Overleaf's toolbar actions, made each time the IDE renders the toolbar.
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const roots = bar ? [container, bar] : [container];
    const place = () => {
      const actions = roots.map((root) => root.querySelector(ACTIONS)).find(Boolean);
      if (!actions || actions.querySelector(":scope > .workshop-ide__host")) return;
      const el = document.createElement("div");
      el.className = "workshop-ide__host";
      actions.prepend(el);
      setSlot(el);
    };
    const observer = new MutationObserver(place);
    for (const root of roots) observer.observe(root, { childList: true, subtree: true });
    place();
    // Overleaf's home link points at its own /project page; here it goes back to the list.
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(HOME)) return;
      event.preventDefault();
      home.current();
    };
    for (const root of roots) root.addEventListener("click", onClick, true);
    return () => {
      observer.disconnect();
      for (const root of roots) root.removeEventListener("click", onClick, true);
    };
  }, [bar]);

  useEffect(() => {
    if (!bar) return;
    let live = true;
    void import("@overleaf-ide").then(({ setToolbarTarget }) => live && setToolbarTarget(bar));
    return () => {
      live = false;
      void import("@overleaf-ide").then(({ setToolbarTarget }) => setToolbarTarget(null));
    };
  }, [bar]);

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
      <ToolbarSlot>
        <div ref={setBar} className="ol-ide workshop-ide__bar" />
      </ToolbarSlot>
      <div ref={ref} className="workshop-ide" />
      {slot && createPortal(toolbar, slot)}
    </>
  );
}
