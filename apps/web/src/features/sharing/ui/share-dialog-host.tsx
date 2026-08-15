"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { ShareableType } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { ShareDialog } from "./share-dialog";

export interface ShareDialogRequest {
  resourceType: ShareableType;
  resourceId: string | null;
  title: string;
  /** Called when the dialog closes, however it closes. */
  onClose?: () => void;
}

interface ShareDialogApi {
  /** Show the dialog; returns a token that identifies this request. */
  open: (req: ShareDialogRequest) => number;
  /** Close, but only if `token` is the request still on screen. */
  close: (token: number) => void;
}

const Ctx = createContext<ShareDialogApi | null>(null);

/**
 * One share dialog for the whole shell, above the screens.
 *
 * The dialog used to live inside whichever card opened it, which made its
 * lifetime the card's lifetime. Cards are dealt into masonry columns by
 * position, so a background refresh that adds or removes one paper moves every
 * card after it into a different column — remounting it, and taking the open
 * dialog (and the share link the user had just created and not yet copied)
 * with it. Hoisting the dialog out of the list makes it immune to that.
 */
export function ShareDialogHost({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<{ token: number; value: ShareDialogRequest } | null>(null);
  const nextToken = useRef(1);

  const open = useCallback((value: ShareDialogRequest) => {
    const token = nextToken.current++;
    setReq({ token, value });
    return token;
  }, []);

  const close = useCallback((token: number) => {
    setReq((prev) => (prev && prev.token !== token ? prev : null));
  }, []);

  const api = useMemo<ShareDialogApi>(() => ({ open, close }), [open, close]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {req && (
        <ShareDialog
          resourceType={req.value.resourceType}
          resourceId={req.value.resourceId}
          projectId={getContainer().projects.context.projectId}
          title={req.value.title}
          onClose={() => {
            req.value.onClose?.();
            close(req.token);
          }}
        />
      )}
    </Ctx.Provider>
  );
}

/** The shell's share dialog, or null outside it (link redemption, tests). */
export function useShareDialogHost(): ShareDialogApi | null {
  return useContext(Ctx);
}
