import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { getContainer } from "@/bootstrap";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { formatError } from "@/lib/format-error";
import type { TabRef } from "@weaveforge/wasm";
import type { Document } from "../application/parts";

/**
 * Full note bodies for the workspace's tabs. The summary the set was built from
 * is a preview; an editor seeded from it would save the cut back over the note,
 * so `hydrate` fetches a note's full body the first time a tab needs it.
 *
 * `bodies` keeps the bodies fetched so far, by id, so a reload does not throw
 * them away; a tab rendered twice asks once.
 */
export function useNoteBodies(
  setDocuments: Dispatch<SetStateAction<Document[] | null>>,
  setError: (message: string) => void,
) {
  const bodies = useRef(new Map<string, string>());
  const inFlight = useRef(new Set<string>());
  const hydrate = useCallback(
    (tab: TabRef) => {
      if (inFlight.current.has(tab.id)) return;
      inFlight.current.add(tab.id);
      void getContainer()
        .vault.getPage(tab.id)
        .then((page) => {
          if (!page) return;
          bodies.current.set(tab.id, page.body);
          // Before the workspace has loaded there is nothing to patch: the load
          // reads the body from `bodies`.
          setDocuments((current) =>
            current?.map((doc) =>
              doc.id === tab.id && doc.kind === tab.kind
                ? { ...doc, body: page.body, hydrated: true }
                : doc,
            ) ?? current,
          );
        })
        .catch((err) => setError(formatError(err)))
        .finally(() => inFlight.current.delete(tab.id));
    },
    [setDocuments, setError],
  );
  return { bodies: bodies.current, hydrate };
}

/**
 * What a tab shows while its note's full body is on the way. Asking from an
 * effect rather than during render keeps the fetch off the render path and
 * runs it once per mount.
 */
export function HydratingDocument({ tab, hydrate }: { tab: TabRef; hydrate: (tab: TabRef) => void }) {
  useEffect(() => {
    hydrate(tab);
  }, [tab, hydrate]);
  return <ScreenLoader status="Loading note…" showTips={false} compact />;
}
