"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { desktop, type DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { INSTALL_097_NOTICE, INSTALL_097_URL, install097Check, type Install097Verdict } from "../application/install-097-guard";

type Gate =
  | { phase: "checking" }
  | { phase: "open" }
  | { phase: "unverified"; notice?: string }
  | { phase: "unknown"; code: string };

/** A check that has not answered within this time counts as unknown, which blocks. */
export const INSTALL_097_CHECK_TIMEOUT_MS = 10_000;

/**
 * One check. `id` changes on every retry or pick, so an answer or timer from an older check is
 * ignored. `folder` is the folder the person picked, or null for the workspace folder.
 */
type Request = { id: number; folder: string | null };

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
 * A folder that verified is made the workspace folder, so the next launch opens it without the
 * gate. Only a verified pick gets here; the gate never persists an unverified one.
 */
async function keepVerifiedFolder(bridge: DesktopBridge, folder: string): Promise<Gate> {
  if (typeof bridge.setVaultRoot !== "function") return { phase: "unknown", code: "SET_FOLDER_UNAVAILABLE" };
  try {
    await bridge.setVaultRoot(folder);
  } catch {
    return { phase: "unknown", code: "SET_FOLDER_FAILED" };
  }
  return { phase: "open" };
}

/**
 * Blocks the app until 0.9.7 has moved an old local database across. While blocked, nothing
 * under it mounts: the children are not rendered at all. Browsers and Android have no desktop
 * bridge and open at once. The check only reads, so the gate never writes data. Every unknown
 * answer (a reject, a timeout) blocks with its error code, a retry, the 0.9.7 download and the
 * folder picker. An unverified report blocks with the same picker, so a moved export folder is
 * not blocked forever.
 */
export function Install097Gate({ children, checkTimeoutMs = INSTALL_097_CHECK_TIMEOUT_MS }: { children: ReactNode; checkTimeoutMs?: number }) {
  // Always starts at "checking", on the server and in the first client render, so the markup
  // matches. The bridge is only read in the effect; with none (browser, Android) it opens then.
  const [gate, setGate] = useState<Gate>({ phase: "checking" });
  const [request, setRequest] = useState<Request>({ id: 0, folder: null });
  const activeId = useRef(0);

  useEffect(() => {
    if (gate.phase !== "checking") return;
    const bridge = desktop();
    if (!bridge) {
      setGate({ phase: "open" });
      return;
    }
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
    timer = setTimeout(() => settle({ phase: "unknown", code: "CHECK_TIMEOUT" }), checkTimeoutMs);
    const folder = request.folder;
    const resolved = folder === null ? workspaceFolder(bridge) : Promise.resolve(folder);
    void resolved
      .then((path) => install097Check(bridge, path))
      .then((verdict): Gate | Promise<Gate> => (verdict.kind === "open" && folder !== null ? keepVerifiedFolder(bridge, folder) : toGate(verdict)))
      .then((next) => settle(next), () => settle({ phase: "unknown", code: "CHECK_FAILED" }));
    return () => {
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [gate.phase, request, checkTimeoutMs]);

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
      {gate.phase === "unverified" ? (
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
      <p>
        <button type="button" onClick={() => void choose()}>
          Choose the folder you exported to
        </button>
      </p>
      {gate.phase === "unverified" && gate.notice && <p role="status">{gate.notice}</p>}
    </main>
  );
}
