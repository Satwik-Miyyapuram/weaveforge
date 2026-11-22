"use client";

import { useEffect, useState, type ReactNode } from "react";
import { desktop, type DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { INSTALL_097_NOTICE, INSTALL_097_URL, install097Check, type Install097Verdict } from "../application/install-097-guard";

type Gate =
  | { phase: "checking" }
  | { phase: "open" }
  | { phase: "unverified" }
  | { phase: "unknown"; code: string };

/** A check that has not answered within this time counts as unknown, which blocks. */
export const INSTALL_097_CHECK_TIMEOUT_MS = 10_000;

/** A folder the person chose on the picker, or null to use the workspace folder. */
type Request = { folder: string | null };

function toGate(verdict: Install097Verdict): Gate {
  return verdict.kind === "open" ? { phase: "open" } : verdict.kind === "unverified" ? { phase: "unverified" } : { phase: "unknown", code: verdict.code };
}

/** The workspace folder in use, or null when none is chosen or the bridge cannot say. */
async function workspaceFolder(bridge: DesktopBridge | null): Promise<string | null> {
  if (!bridge) return null;
  try {
    return (await bridge.vaultRoot())?.path ?? null;
  } catch {
    return null;
  }
}

/**
 * Blocks the app until 0.9.7 has moved an old local database across. While blocked, nothing
 * under it mounts: the children are not rendered at all. Browsers and Android have no desktop
 * bridge and open at once. The check only reads, so the gate never writes data. Every unknown
 * answer (a reject, a timeout) blocks with its error code and a retry. An unverified report
 * blocks with a folder picker, so a moved export folder is not blocked forever.
 */
export function Install097Gate({ children, checkTimeoutMs = INSTALL_097_CHECK_TIMEOUT_MS }: { children: ReactNode; checkTimeoutMs?: number }) {
  // Always starts at "checking", on the server and in the first client render, so the markup
  // matches. The bridge is only read in the effect; with none (browser, Android) it opens then.
  const [gate, setGate] = useState<Gate>({ phase: "checking" });
  const [request, setRequest] = useState<Request>({ folder: null });

  useEffect(() => {
    if (gate.phase !== "checking") return;
    const bridge = desktop();
    if (!bridge) {
      setGate({ phase: "open" });
      return;
    }
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (next: Gate) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      setGate(next);
    };
    timer = setTimeout(() => settle({ phase: "unknown", code: "CHECK_TIMEOUT" }), checkTimeoutMs);
    const folder = request.folder ?? null;
    const resolved = folder === null ? workspaceFolder(bridge) : Promise.resolve(folder);
    void resolved
      .then((path) => install097Check(bridge, path))
      .then((verdict) => settle(toGate(verdict)), () => settle({ phase: "unknown", code: "CHECK_FAILED" }));
    return () => {
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [gate.phase, request, checkTimeoutMs]);

  const retry = () => {
    setGate({ phase: "checking" });
    setRequest({ folder: null });
  };

  const choose = async () => {
    const bridge = desktop();
    if (!bridge) return;
    let picked: Awaited<ReturnType<DesktopBridge["chooseVaultRoot"]>>;
    try {
      picked = await bridge.chooseVaultRoot();
    } catch {
      setGate({ phase: "unknown", code: "PICK_FAILED" });
      return;
    }
    if (!picked) return;
    setGate({ phase: "checking" });
    setRequest({ folder: picked.path });
  };

  if (gate.phase === "checking") {
    return (
      <main className="app-shell" style={{ padding: 24, maxWidth: 480, margin: "10vh auto" }}>
        <p role="status">Checking…</p>
      </main>
    );
  }
  if (gate.phase === "open") return <>{children}</>;
  return (
    <main className="app-shell" style={{ padding: 24, maxWidth: 480, margin: "10vh auto" }}>
      {gate.phase === "unverified" ? (
        <>
          <h1 style={{ fontSize: "1.25rem", marginBottom: 8 }}>{INSTALL_097_NOTICE.title}</h1>
          <p>{INSTALL_097_NOTICE.body}</p>
          <p>
            <a href={INSTALL_097_URL} target="_blank" rel="noopener noreferrer">
              Download WeaveForge 0.9.7
            </a>
          </p>
          <p>
            <button type="button" onClick={() => void choose()}>
              Choose the folder you exported to
            </button>
          </p>
        </>
      ) : (
        <>
          <h1 style={{ fontSize: "1.25rem", marginBottom: 8 }}>WeaveForge could not check the local database.</h1>
          <p>Your data is safe. Nothing was moved.</p>
          <p>
            Error code: <code>{gate.code}</code>
          </p>
          <p>
            <button type="button" onClick={retry}>
              Try again
            </button>
          </p>
        </>
      )}
    </main>
  );
}
