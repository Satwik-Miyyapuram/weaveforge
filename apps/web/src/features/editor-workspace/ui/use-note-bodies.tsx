import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { getContainer } from "@/bootstrap";
import { Button } from "@/components/button";
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
 *
 * `unavailable` names the notes whose body could not be had, with what to tell
 * the reader: a note that is gone, or a fetch that failed. Without it such a tab
 * stayed on "Loading note…" for good (P2-141).
 */
/** Why a note's body could not be had, and whether asking again can help. */
export interface BodyProblem {
  message: string;
  retryable: boolean;
}

export function useNoteBodies(
  setDocuments: Dispatch<SetStateAction<Document[] | null>>,
  setError: (message: string) => void,
) {
  const bodies = useRef(new Map<string, string>());
  const inFlight = useRef(new Set<string>());
  const [unavailable, setUnavailable] = useState<ReadonlyMap<string, BodyProblem>>(() => new Map());
  const markUnavailable = useCallback((id: string, problem: BodyProblem | null) => {
    setUnavailable((current) => {
      if (problem === null && !current.has(id)) return current;
      const next = new Map(current);
      if (problem === null) next.delete(id);
      else next.set(id, problem);
      return next;
    });
  }, []);
  const hydrate = useCallback(
    (tab: TabRef) => {
      if (inFlight.current.has(tab.id)) return;
      inFlight.current.add(tab.id);
      void getContainer()
        .vault.getPage(tab.id)
        .then((page) => {
          if (!page) {
            markUnavailable(tab.id, { message: "This note no longer exists. Close its tab.", retryable: false });
            return;
          }
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
        .catch((err) => {
          const message = formatError(err);
          setError(message);
          markUnavailable(tab.id, { message: `Could not load this note: ${message}`, retryable: true });
        })
        .finally(() => inFlight.current.delete(tab.id));
    },
    [setDocuments, setError, markUnavailable],
  );
  const retry = useCallback(
    (tab: TabRef) => {
      markUnavailable(tab.id, null);
      hydrate(tab);
    },
    [hydrate, markUnavailable],
  );
  return { bodies: bodies.current, hydrate, unavailable, retry };
}

/**
 * What a tab shows while its note's full body is on the way. Asking from an
 * effect rather than during render keeps the fetch off the render path and
 * runs it once per mount. With a `problem` it shows that instead, and offers
 * the fetch again when `onRetry` is given.
 */
export function HydratingDocument({
  tab,
  hydrate,
  problem,
  onRetry,
}: {
  tab: TabRef;
  hydrate: (tab: TabRef) => void;
  problem?: string;
  onRetry?: () => void;
}) {
  useEffect(() => {
    if (!problem) hydrate(tab);
  }, [tab, hydrate, problem]);
  if (problem) {
    return (
      <div>
        <p className="muted">{problem}</p>
        {onRetry && (
          <Button variant="ghost" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    );
  }
  return <ScreenLoader status="Loading note…" showTips={false} compact />;
}
