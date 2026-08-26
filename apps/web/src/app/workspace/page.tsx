"use client";

import { useEffect, useState } from "react";

import { ScreenLoader } from "@/components/weaveforge-loader";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { WorkspaceScreen } from "@/features/editor-workspace";

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
