"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { ScreenLoader } from "@/components/weaveforge-loader";
import { desktop } from "@/lib/desktop/desktop-bridge";
/**
 * Loaded on demand, and only after the desktop check passes. A static import
 * would put the whole editor shell — panes, palette, the collaborative editor
 * stack — into the web bundle for a screen the web build never renders.
 */
const WorkspaceScreen = dynamic(
  () => import("@/features/editor-workspace").then((m) => m.WorkspaceScreen),
  { ssr: false, loading: () => <ScreenLoader status="Loading workspace…" /> },
);

/**
 * The editor workspace is desktop-only.
 *
 * Not a licensing decision — a browser tab cannot give the keyboard shortcuts
 * this shell needs (Ctrl-W closes the tab, Ctrl-P prints), and a split-pane
 * editor on a phone is a worse version of the screens that already exist.
 *
 * The check runs after mount: the server render has no `window`, so deciding
 * there would ship markup that flips on hydration.
 */
export default function WorkspacePage() {
  const [host, setHost] = useState<"unknown" | "desktop" | "web">("unknown");
  useEffect(() => setHost(desktop() !== null ? "desktop" : "web"), []);

  if (host === "unknown") {
    return (
      <section className="screen">
        <ScreenLoader status="Loading workspace…" />
      </section>
    );
  }

  if (host === "web") {
    return (
      <section className="screen">
        <h1>Editor workspace</h1>
        <p className="muted">
          The split-pane editor runs in the desktop app, where it can own the keyboard shortcuts it
          needs. Your notes, papers and report are all editable here in the browser from their own
          screens.
        </p>
      </section>
    );
  }

  return <WorkspaceScreen />;
}
