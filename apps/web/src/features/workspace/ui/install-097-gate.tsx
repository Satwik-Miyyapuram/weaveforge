"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { desktop, type DesktopBridge } from "@/lib/desktop/desktop-bridge";
import {
  INSTALL_097_NOTICE,
  INSTALL_097_URL,
  INSTALL_097_WEB_NOTICE,
  install097Check,
  type Install097OldUserPort,
  type Install097Verdict,
} from "../application/install-097-guard";
import { browserOldDataPort } from "../infrastructure/install-097-browser-port";

type Gate =
  | { phase: "checking" }
  | { phase: "open" }
  | { phase: "unverified"; notice?: string; action?: "web-export" }
  | { phase: "unknown"; code: string };

/** Resolves this browser's own reader (no account, no server); null when there is nothing to check. */
export type WebPortResolver = () => Promise<Install097OldUserPort | null>;

/** A check that has not answered within this time opens the app (fail open). */
export const INSTALL_097_CHECK_TIMEOUT_MS = 10_000;

/**
 * One check. `id` changes on every retry or pick, so an answer or timer from an older check is
 * ignored. `folder` is the folder the person picked, or null for the workspace folder.
 */
type Request = { id: number; folder: string | null };

function toGate(verdict: Install097Verdict): Gate {
  if (verdict.kind === "open") return { phase: "open" };
  if (verdict.kind === "unverified") return { phase: "unverified", action: verdict.action };
  return { phase: "unknown", code: verdict.code };
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
 * A folder that verified is made the workspace folder, so the next launch opens it without the
 * gate. Only a verified pick gets here; the gate never persists an unverified one.
 */
async function keepVerifiedFolder(bridge: DesktopBridge, folder: string): Promise<Gate> {
  // The check already passed; a failed save of the folder is not a reason to block.
  if (typeof bridge.setVaultRoot !== "function") return { phase: "open" };
  try {
    await bridge.setVaultRoot(folder);
  } catch {
    return { phase: "open" };
  }
  return { phase: "open" };
}

/**
 * Blocks the app only when 0.9.7 has confirmed old data on this device that is not yet moved or
 * exported. While blocked, nothing under it mounts. Browsers and Android have no
 * desktop bridge and open at once. The check only reads, so the gate never writes data. A reject,
 * a timeout, or a check that cannot answer opens (fail open). The blocked screen shows the 0.9.7
 * download and the folder picker; an unverified report uses the same picker, so a moved export
 * folder is not blocked forever. In a browser this device's own reader decides instead (old 0.9.7
 * data here, no verified 0.9.7 report in this workspace), and the picker is hidden: the fix there is 0.9.7, not a folder.
 */
export function Install097Gate({
  children,
  checkTimeoutMs = INSTALL_097_CHECK_TIMEOUT_MS,
  webPort = browserOldDataPort,
}: {
  children: ReactNode;
  checkTimeoutMs?: number;
  webPort?: WebPortResolver;
}) {
  // Always starts at "checking", on the server and in the first client render, so the markup
  // matches. The bridge is only read in the effect; with none (browser, Android) it opens then.
  const [gate, setGate] = useState<Gate>({ phase: "checking" });
  const [request, setRequest] = useState<Request>({ id: 0, folder: null });
  const activeId = useRef(0);

  useEffect(() => {
    if (gate.phase !== "checking") return;
    const bridge = desktop();
    const id = request.id;
    activeId.current = id;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (next: Gate) => {
      if (settled || activeId.current !== id) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      setGate(next);
    };
    // A check that does not answer in time cannot confirm old data, so it opens (fail open).
    timer = setTimeout(() => settle({ phase: "open" }), checkTimeoutMs);
    if (!bridge) {
      // Web or Android: this browser's own reader decides. A null port opens.
      void webPort()
        .then((port) => install097Check(null, null, port ?? undefined))
        .then((verdict) => settle(toGate(verdict)), () => settle({ phase: "open" }));
    } else {
      const folder = request.folder;
      const resolved = folder === null ? workspaceFolder(bridge) : Promise.resolve(folder);
      // Desktop: only this computer's old database decides (the check is per device).
      void resolved
        .then((path) => install097Check(bridge, path))
        .then((verdict): Gate | Promise<Gate> => (verdict.kind === "open" && folder !== null ? keepVerifiedFolder(bridge, folder) : toGate(verdict)))
        .then((next) => settle(next), () => settle({ phase: "open" }));
    }
    return () => {
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [gate.phase, request, checkTimeoutMs, webPort]);

  const retry = () => {
    setGate({ phase: "checking" });
    setRequest((prev) => ({ id: prev.id + 1, folder: null }));
  };

  const choose = async () => {
    const bridge = desktop();
    if (!bridge) return;
    if (typeof bridge.pickFolder !== "function") {
      setGate({ phase: "unknown", code: "PICK_UNAVAILABLE" });
      return;
    }
    let picked: string | null;
    try {
      picked = await bridge.pickFolder();
    } catch {
      setGate({ phase: "unknown", code: "PICK_FAILED" });
      return;
    }
    if (!picked) {
      setGate({ phase: "unverified", notice: "No folder chosen" });
      return;
    }
    setGate({ phase: "checking" });
    setRequest((prev) => ({ id: prev.id + 1, folder: picked }));
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
      {gate.phase === "unverified" && gate.action === "web-export" ? (
        <>
          <h1 style={{ fontSize: "1.25rem", marginBottom: 8 }}>{INSTALL_097_WEB_NOTICE.title}</h1>
          <p>{INSTALL_097_WEB_NOTICE.body}</p>
        </>
      ) : gate.phase === "unverified" ? (
        <>
          <h1 style={{ fontSize: "1.25rem", marginBottom: 8 }}>{INSTALL_097_NOTICE.title}</h1>
          <p>{INSTALL_097_NOTICE.body}</p>
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
      <p>
        <a href={INSTALL_097_URL} target="_blank" rel="noopener noreferrer">
          Download WeaveForge 0.9.7
        </a>
      </p>
      {gate.phase !== "unverified" || gate.action !== "web-export" ? (
        <p>
          <button type="button" onClick={() => void choose()}>
            Choose the folder you exported to
          </button>
        </p>
      ) : null}
      {gate.phase === "unverified" && gate.notice && <p role="status">{gate.notice}</p>}
    </main>
  );
}
