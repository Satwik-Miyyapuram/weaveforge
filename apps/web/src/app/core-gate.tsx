"use client";

import { useCallback, useEffect, useState } from "react";
import { ThesisLoaderScreen } from "@/components/weaveforge-loader";
import { Button } from "@/components/button";
import { loadCore } from "@/lib/rust-core";

type CoreLoadState = "loading" | "ready" | "failed";

/**
 * Loads the Rust core and tracks it. Always starts at "loading", even when the
 * core is already loaded, so the server and first client render agree.
 */
export function useCoreLoad(load: () => Promise<unknown> = loadCore): { state: CoreLoadState; retry: () => void } {
  const [state, setState] = useState<CoreLoadState>("loading");
  useEffect(() => {
    if (state !== "loading") return;
    let live = true;
    load().then(
      () => live && setState("ready"),
      () => live && setState("failed"),
    );
    return () => {
      live = false;
    };
  }, [state, load]);
  const retry = useCallback(() => setState("loading"), []);
  return { state, retry };
}

/**
 * Renders children only once the Rust core is loaded, so anything inside may
 * call `readyCore()` during render. The browser fetches the .wasm once; the
 * service worker caches it for offline starts.
 */
export function CoreGate({ children }: { children: React.ReactNode }) {
  const { state, retry } = useCoreLoad();
  if (state === "ready") return <>{children}</>;
  if (state === "loading") return <ThesisLoaderScreen />;
  return (
    <main className="app-shell">
      <p role="alert">WeaveForge could not load its core module. Check your connection and try again.</p>
      <Button onClick={retry}>Try again</Button>
    </main>
  );
}
