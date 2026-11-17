"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { useAuth } from "@/features/auth/ui/auth-provider";
import { registerSessionReset } from "@/lib/cache/parts";
import { forgetBootSnapshot, readBootSnapshot, saveBootSnapshot, screenPath, styleBuildKey } from "@/lib/boot-snapshot";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { readStored } from "@/lib/safe-storage";
import { onScreenShown } from "@/lib/screen-shown";

/**
 * The last screen, painted the moment the window opens.
 *
 * A cold start waits for the Rust core, the session and the local database
 * before any screen can render, which is seconds after a crash. The screen
 * the person left is kept as markup (`lib/boot-snapshot.ts`) and painted over
 * the loader as a picture: inert, hidden from assistive tech, taking no input.
 * It goes as soon as the live screen is up, the person clicks or types, the
 * session turns out to be someone else's (or nobody's), or after 10 seconds.
 *
 * Desktop app only, like every device snapshot.
 */
type Snap = { html: string; userId: string };

const MAX_SHOW_MS = 10_000;
/** `ProjectProvider`'s key for the project the app opens on. */
const PROJECT_KEY = "thesis.projectId";
const SHOWN_MARK = "wf:boot:snapshot:shown";
/** The mark `markScreenShown` leaves for a live screen (`lib/screen-shown.ts`). */
const SHOWN_PATTERN = /^wf:screen:.+:shown$/;

/** Left out of the saved markup: live-only, heavy, or wrong once restarted. */
const STRIP =
  "script, style, noscript, iframe, canvas, video, audio, object, embed, dialog, [role='dialog'], [role='menu'], " +
  "[role='listbox'], .keep-alive-host:not([data-shown]), .workspace-host:not([data-shown]), img[src^='blob:']";

/** Read back through DOMPurify, so storage edited by hand can never run code. */
const PURIFY = {
  FORBID_TAGS: ["style", "form", "dialog", "iframe", "video", "audio", "canvas", "object", "embed"],
  FORBID_ATTR: ["id", "autofocus", "contenteditable", "tabindex"],
};

export function BootSnapshot() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const userId = user?.id ?? null;
  useBootSnapshotRecorder(userId);
  return (
    <BootSnapshotView
      userId={loading ? undefined : userId}
      pathname={pathname}
      load={loadHere}
      onForget={forgetBootSnapshot}
    />
  );
}

/**
 * `userId` is undefined while the session is still being read, then the
 * signed-in user's id or null. Exported for tests.
 */
export function BootSnapshotView({
  userId,
  pathname,
  load,
  onForget,
}: {
  userId: string | null | undefined;
  pathname: string;
  load: () => Promise<Snap | null>;
  onForget: () => void;
}) {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [done, setDone] = useState(false);
  // The screen the window opened on; a navigation away ends the picture.
  const [openedOn] = useState(() => screenPath(pathname));

  useEffect(() => {
    let live = true;
    load().then(
      (found) => live && found && setSnap(found),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [load]);

  const wrongUser = snap !== null && userId !== undefined && userId !== snap.userId;
  const moved = screenPath(pathname) !== openedOn;
  const shown = snap !== null && !done && !wrongUser && !moved;

  useEffect(() => {
    if (done || snap === null) return;
    if (wrongUser) {
      setDone(true);
      onForget();
    } else if (moved) setDone(true);
  }, [done, snap, wrongUser, moved, onForget]);

  // The click guard outlives the picture (it swallows the click that follows
  // the dismissing press), so only unmounting clears it.
  const clickGuardOff = useRef<(() => void) | null>(null);
  useEffect(() => () => clickGuardOff.current?.(), []);

  useEffect(() => {
    if (!shown) return;
    if (typeof performance !== "undefined" && typeof performance.mark === "function") performance.mark(SHOWN_MARK);
    // The live screen may have reported before the snapshot finished loading.
    if (typeof performance !== "undefined" && typeof performance.getEntriesByType === "function") {
      if (performance.getEntriesByType("mark").some((m) => SHOWN_PATTERN.test(m.name))) {
        setDone(true);
        return;
      }
    }
    const end = () => setDone(true);
    const host = typeof window === "undefined" ? null : window;
    // The first click is swallowed, so it never lands on what is underneath.
    // Cancelling pointerdown does not cancel its click, so that is stopped too.
    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      const guard = (click: Event) => {
        click.preventDefault();
        click.stopPropagation();
      };
      clickGuardOff.current?.();
      host?.addEventListener("click", guard, { capture: true, once: true });
      const timeout = setTimeout(() => host?.removeEventListener("click", guard, { capture: true }), 1000);
      clickGuardOff.current = () => {
        clearTimeout(timeout);
        host?.removeEventListener("click", guard, { capture: true });
      };
      end();
    };
    const off = onScreenShown(end);
    const timer = setTimeout(end, MAX_SHOW_MS);
    host?.addEventListener("pointerdown", swallow, true);
    host?.addEventListener("keydown", end, true);
    return () => {
      off();
      clearTimeout(timer);
      host?.removeEventListener("pointerdown", swallow, true);
      host?.removeEventListener("keydown", end, true);
    };
  }, [shown]);

  if (!shown) return null;
  return (
    <div
      className="boot-snapshot"
      style={{ pointerEvents: "auto" }}
      aria-hidden
      inert
      dangerouslySetInnerHTML={{ __html: snap.html }}
    />
  );
}

/** This build's stylesheets: the saved markup is only right with the CSS it was drawn with. */
function currentBuild(): string {
  const links = document.querySelectorAll<HTMLLinkElement>("link[rel='stylesheet']");
  return styleBuildKey([...links].map((link) => link.getAttribute("href") ?? ""));
}

async function loadHere(): Promise<Snap | null> {
  if (!desktop()) return null;
  const hit = readBootSnapshot({
    build: currentBuild(),
    projectId: readStored(PROJECT_KEY),
    path: window.location.pathname,
  });
  if (!hit) return null;
  const { default: DOMPurify } = await import("dompurify");
  return { userId: hit.userId, html: DOMPurify.sanitize(hit.html, PURIFY) };
}

/** The live shell's markup, without what must not be painted again. */
function captureLayout(): string | null {
  const live = [...document.querySelectorAll(".layout")].find((el) => !el.closest(".boot-snapshot"));
  return live ? captureLayoutFrom(live) : null;
}

/** Copies `node` without the parts `STRIP` names, so a hidden host is never cloned. */
function copyWithout(node: Node): Node {
  const copy = node.cloneNode(false);
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 1 && (child as Element).matches(STRIP)) continue;
    copy.appendChild(copyWithout(child));
  }
  return copy;
}

/** Exported for tests. */
export function captureLayoutFrom(live: Element): string {
  const copy = copyWithout(live) as Element;
  copy.classList.remove("anim");
  return copy.outerHTML;
}

/**
 * Saves the screen on show (when the browser is idle) and when the window is
 * hidden or closed, so the next start has the latest one. Only a path that
 * reported "shown" is saved, so closing on settings never paints settings.
 * Signing out forgets the snapshot and stops saving until another user is set.
 * Exported for tests.
 */
export function useBootSnapshotRecorder(userId: string | null, capture: () => string | null = captureLayout): void {
  useEffect(() => {
    if (!userId || !desktop()) return;
    let pending: ReturnType<typeof setTimeout> | number | undefined;
    let blocked = false;
    let shownPath: string | null = null;
    let lastSaved: string | null = null;
    const save = () => {
      if (blocked || shownPath === null || screenPath(window.location.pathname) !== shownPath) return;
      const projectId = readStored(PROJECT_KEY);
      const html = capture();
      if (!projectId || !html) return;
      const stamp = `${shownPath}\n${html}`;
      if (stamp === lastSaved) return;
      lastSaved = stamp;
      saveBootSnapshot({ build: currentBuild(), userId, projectId, path: window.location.pathname, html });
    };
    const cancel = () => {
      if (pending === undefined) return;
      if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(pending as number);
      else clearTimeout(pending);
      pending = undefined;
    };
    const later = () => {
      cancel();
      pending =
        typeof window.requestIdleCallback === "function"
          ? window.requestIdleCallback(save, { timeout: 2000 })
          : setTimeout(save, 500);
    };
    const onShown = () => {
      shownPath = screenPath(window.location.pathname);
      later();
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") save();
    };
    const offReset = registerSessionReset(() => {
      blocked = true;
      cancel();
      lastSaved = null;
      forgetBootSnapshot();
    });
    const off = onScreenShown(onShown);
    // A screen that reported before this effect ran is still on show.
    if (typeof performance !== "undefined" && typeof performance.getEntriesByType === "function") {
      if (performance.getEntriesByType("mark").some((m) => SHOWN_PATTERN.test(m.name))) onShown();
    }
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      off();
      offReset();
      cancel();
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [userId, capture]);
}
