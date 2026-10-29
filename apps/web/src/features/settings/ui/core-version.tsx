"use client";

import { useEffect, useState } from "react";
import { loadCoreInfo } from "@/lib/rust-core";

/** The Rust core's version, the first thing the app asks the core. */
export function CoreVersion() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadCoreInfo().then(
      (info) => live && setVersion(info.version),
      () => {},
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
