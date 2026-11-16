"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { ScreenLoader } from "@/components/weaveforge-loader";
import { DESKTOP_BREAKPOINT_PX } from "@/lib/parts";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { ScreenActiveContext } from "@/lib/hooks/use-screen-active";

/**
 * Loaded on demand, and only once the window is known to be wide enough. A
 * static import would put the whole editor shell — panes, palette, the
 * collaborative editor stack — into every page's bundle.
 */
const WorkspaceScreen = dynamic(
  () => import("./workspace-screen").then((m) => m.WorkspaceScreen),
  { ssr: false, loading: () => <ScreenLoader status="Loading workspace…" /> },
);

/** The split pane's minimum: the width the app switches to its desktop layout at. */
const WIDE = `(min-width: ${DESKTOP_BREAKPOINT_PX}px)`;

/**
 * Whether there is room for the workspace. The desktop app always has it; a
 * browser — including the web app on an iPad's home screen — when the window is
 * at least as wide as the desktop layout, following resizes and rotation.
 *
 * The check runs after mount: the server render has no `window`, so deciding
 * there would ship markup that flips on hydration.
 */
function useRoom(): "unknown" | "wide" | "narrow" {
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
  return room;
}

/**
 * The editor workspace, kept mounted once opened.
 *
 * It lives beside the routes rather than in `/workspace`'s page: a page is
 * thrown away when the person goes to another screen, and coming back rebuilt
 * everything — the workspace's lists, every open tab's note and PDF, every
 * editor. Here it is only hidden while another screen is up, and on the way
 * back it is shown as it was left. Its window-wide listeners check
 * `useScreenActive` so its shortcuts do not act on a screen nobody can see.
 *
 * Narrower than the desktop layout, a split pane is a worse version of the
 * screens that already exist, so `/workspace` says what to do instead.
 */
export function WorkspaceHost({ shown }: { shown: boolean }) {
  const room = useRoom();
  const [opened, setOpened] = useState(false);
  if (shown && room === "wide" && !opened) setOpened(true);

  if (room === "narrow") {
    if (!shown) return null;
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
  if (!opened) {
    if (!shown) return null;
    return (
      <section className="screen">
        <ScreenLoader status="Loading workspace…" />
      </section>
    );
  }
  return (
    <div className="workspace-host" data-shown={shown ? "" : undefined} inert={!shown}>
      <ScreenActiveContext.Provider value={shown}>
        <WorkspaceScreen />
      </ScreenActiveContext.Provider>
    </div>
  );
}
