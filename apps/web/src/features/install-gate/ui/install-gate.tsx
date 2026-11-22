"use client";

/**
 * The "install 0.9.7 first" gate. Old-data upgrade users see a blocking screen until they have
 * run 0.9.7 once; new installs, browsers and the Electron shell see nothing. The desktop shell
 * decides (`installGateRequired`); an error from that command shows the gate, never hides it.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { desktop } from "@/lib/desktop/desktop-bridge";

export const INSTALL_GATE_TEXT =
  "This update needs WeaveForge 0.9.7 first. Install 0.9.7, open it once so it moves your data to files, then install 0.9.8.";

/** Asks the desktop shell. No bridge or no command (browser, Electron) means no gate. */
export async function askInstallGate(): Promise<boolean> {
  const bridge = desktop();
  if (!bridge?.installGateRequired) return false;
  try {
    return await bridge.installGateRequired();
  } catch {
    return true;
  }
}

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2147483000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  background: "var(--bg, #000)",
  color: "var(--text, #fff)",
};

export function InstallGate({ check = askInstallGate }: { check?: () => Promise<boolean> }) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let live = true;
    const block = () => {
      if (live) setBlocked(true);
    };
    check().then((required) => {
      if (required) block();
    }, block);
    return () => {
      live = false;
    };
  }, [check]);

  if (!blocked) return null;
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="install-gate-text" style={overlay}>
      <p id="install-gate-text" style={{ maxWidth: "36rem", lineHeight: 1.5 }}>
        {INSTALL_GATE_TEXT}
      </p>
    </div>
  );
}
