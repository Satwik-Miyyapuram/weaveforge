"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { ScreenLoader } from "@/components/weaveforge-loader";
import { DESKTOP_BREAKPOINT_PX } from "@/lib/breakpoints";
import { desktop } from "@/lib/desktop/desktop-bridge";
/**
 * Loaded on demand, and only once the window is known to be wide enough. A
 * static import would put the whole editor shell — panes, palette, the
 * collaborative editor stack — into every page's bundle.
 */
const WorkspaceScreen = dynamic(
  () => import("@/features/editor-workspace").then((m) => m.WorkspaceScreen),
  { ssr: false, loading: () => <ScreenLoader status="Loading workspace…" /> },
);

/** The split pane's minimum: the width the app switches to its desktop layout at. */
const WIDE = `(min-width: ${DESKTOP_BREAKPOINT_PX}px)`;

/**
 * The editor workspace, wherever there is room for it.
 *
 * The desktop app always has it. In a browser — including the web app added to
 * an iPad's home screen — it opens when the window is at least as wide as the
 * desktop layout, and follows the window as it is resized or the tablet turned.
 * A browser keeps Ctrl-W and Ctrl-N for itself, so there those two commands are
 * reached from the strip and the explorer (see `module.ts`).
 *
 * Narrower than that, a split pane is a worse version of the screens that
 * already exist, so the page says what to do instead of squeezing it in.
 *
 * The check runs after mount: the server render has no `window`, so deciding
 * there would ship markup that flips on hydration.
 */
export default function WorkspacePage() {
  const [room, setRoom] = useState<"unknown" | "wide" | "narrow">("unknown");
  useEffect(() => {
    if (desktop() !== null) {
      setRoom("wide");
      return;
    }
    const query = window.matchMedia(WIDE);
    const update = () => setRoom(query.matches ? "wide" : "narrow");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  if (room === "unknown") {
    return (
      <section className="screen">
        <ScreenLoader status="Loading workspace…" />
      </section>
    );
  }

  if (room === "narrow") {
    return (
      <section className="screen">
        <h1>Editor workspace</h1>
        <p className="muted">
          The split-pane editor needs a wider window. Turn a tablet sideways or widen the window,
          and it opens here. Your notes, papers and report are all editable from their own screens
          in the meantime.
        </p>
      </section>
    );
  }

  return (
    <>
      <h1 className="sr-only">Workspace</h1>
      <WorkspaceScreen />
    </>
  );
}
