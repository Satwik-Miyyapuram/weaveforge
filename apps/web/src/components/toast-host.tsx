"use client";

import { useEffect, useSyncExternalStore } from "react";

import { Button, CloseButton } from "./button";
import { isEditableTarget } from "@/lib/editable-target";
import { toasts, type Toast, type ToastStore } from "@/lib/toast/toast-store";

/** Ctrl+Z / Cmd+Z, not in a text field (which has its own undo). */
export function isUndoKey(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return false;
  if (event.key.toLowerCase() !== "z") return false;
  return !isEditableTarget(event.target);
}

/** The bottom-centre stack. The live region stays mounted so the first toast is announced. */
export function ToastList({ store, toasts: list }: { store: ToastStore; toasts: readonly Toast[] }) {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          className="toast"
          onMouseEnter={() => store.pause(t.id, "hover")}
          onMouseLeave={() => store.resume(t.id, "hover")}
          onFocus={() => store.pause(t.id, "focus")}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) store.resume(t.id, "focus");
          }}
        >
          <span className="toast-message">{t.message}</span>
          {t.actionLabel && (
            <Button size="sm" variant="ghost" onClick={() => store.act(t.id)}>
              {t.actionLabel}
            </Button>
          )}
          <CloseButton label="Dismiss" onClick={() => store.dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}

/** Mounted once in the app shell. Toasts survive route changes. */
export function ToastHost() {
  const list = useSyncExternalStore(
    (fn) => toasts.subscribe(fn),
    () => toasts.snapshot(),
    () => toasts.snapshot(),
  );

  useEffect(() => {
    const onVisibility = () => toasts.setWindowHidden(document.visibilityState === "hidden");
    const onKey = (e: KeyboardEvent) => {
      if (isUndoKey(e) && toasts.undoLatest()) e.preventDefault();
    };
    // Quitting or reloading commits what the user already chose to delete.
    const onQuit = () => toasts.flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pagehide", onQuit);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pagehide", onQuit);
    };
  }, []);

  return <ToastList store={toasts} toasts={list} />;
}
