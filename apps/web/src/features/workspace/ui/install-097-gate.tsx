"use client";

import { useEffect, useState, type ReactNode } from "react";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { INSTALL_097_NOTICE, INSTALL_097_URL, install097RequiredFrom } from "../application/install-097-guard";

type Gate = "checking" | "open" | "blocked";

/** A check that has not answered within this time counts as unknown, which blocks. */
export const INSTALL_097_CHECK_TIMEOUT_MS = 10_000;

/**
 * Blocks the app until 0.9.7 has moved an old local database across. While blocked, nothing
 * under it mounts: the children are not rendered at all. Browsers and Android have no desktop
 * bridge and open at once. The check only reads, so the gate never writes data. Every unknown
 * answer (a reject, a timeout) blocks, and the blocked view offers a retry.
 */
export function Install097Gate({ children, checkTimeoutMs = INSTALL_097_CHECK_TIMEOUT_MS }: { children: ReactNode; checkTimeoutMs?: number }) {
  const [gate, setGate] = useState<Gate>(() => (desktop() ? "checking" : "open"));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (gate !== "checking") return;
    let settled = false;
    const settle = (next: Gate) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setGate(next);
    };
    const timer = setTimeout(() => settle("blocked"), checkTimeoutMs);
    install097RequiredFrom(desktop()).then(
      (required) => settle(required ? "blocked" : "open"),
      () => settle("blocked"),
    );
    return () => {
      settled = true;
      clearTimeout(timer);
    };
  }, [gate, attempt, checkTimeoutMs]);

  if (gate === "checking") return null;
  if (gate === "open") return <>{children}</>;
  return (
    <main className="app-shell" style={{ padding: 24, maxWidth: 480, margin: "10vh auto" }}>
      <h1 style={{ fontSize: "1.25rem", marginBottom: 8 }}>{INSTALL_097_NOTICE.title}</h1>
      <p>{INSTALL_097_NOTICE.body}</p>
      <p>
        <a href={INSTALL_097_URL} target="_blank" rel="noopener noreferrer">
          Download WeaveForge 0.9.7
        </a>
      </p>
      <p>
        <button type="button" onClick={() => { setGate("checking"); setAttempt((n) => n + 1); }}>
          Try again
        </button>
      </p>
    </main>
  );
}
