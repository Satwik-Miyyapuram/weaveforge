import { useEffect, useRef } from "react";
import type { TabRef } from "@weaveforge/wasm";

import { formatError } from "@/lib/format-error";
import { useScreenActive } from "@/lib/hooks/use-screen-active";
import { readyCore } from "@/lib/rust-core";
import type { Document, WorkspaceData } from "../application/parts";

/** The tab named by `?open=kind:id`, if the URL names one. */
export function requestedTab(): TabRef | null {
  const raw = new URLSearchParams(window.location.search).get("open");
  if (!raw) return null;
  const [kind, ...rest] = raw.split(":");
  const id = rest.join(":");
  return kind && id ? { kind, id } : null;
}

/**
 * Coming back to the workspace, which stayed mounted while another screen was
 * up (`workspace-host.tsx`). Its lists are read again behind what is on screen,
 * with no loader, so a note made elsewhere is in the explorer; and a document
 * another screen handed over with `?open=kind:id` opens, as it does on a first
 * load.
 */
export function useReturnRefresh(
  reload: () => Promise<WorkspaceData>,
  open: (doc: Document) => void,
  setError: (message: string) => void,
) {
  const active = useScreenActive();
  const wasActive = useRef(active);
  useEffect(() => {
    const back = active && !wasActive.current;
    wasActive.current = active;
    if (!back) return;
    let cancelled = false;
    reload().then(
      (data) => {
        if (cancelled) return;
        const requested = requestedTab();
        if (!requested) return;
        window.history.replaceState(null, "", window.location.pathname);
        const key = readyCore().tabKey(requested);
        const doc = data.documents.find((d) => readyCore().tabKey(d) === key);
        if (doc) open(doc);
      },
      (err: unknown) => {
        if (!cancelled) setError(formatError(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, reload, open, setError]);
}
