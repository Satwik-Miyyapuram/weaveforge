"use client";

import { useEffect, useState } from "react";
import { coreInfo } from "@weaveforge/wasm";
import { loadCore } from "@/lib/rust-core";

/** The Rust core's version, the first thing the app asks the core. */
export function CoreVersion() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadCore().then(
      () => live && setVersion(coreInfo().version),
      (error: unknown) => console.error("Rust core failed to load", error),
    );
    return () => {
      live = false;
    };
  }, []);
  return <CoreVersionView version={version} />;
}

export function CoreVersionView({ version }: { version: string | null }) {
  if (version === null) return null;
  return (
    <p className="muted" data-testid="core-version">
      Core {version}
    </p>
  );
}
