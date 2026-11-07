"use client";

import { useEffect, useState } from "react";

import { desktop } from "@/lib/desktop/desktop-bridge";
import { readInkHapticsOn, writeInkHapticsOn } from "@/lib/ink-haptics-preference";

interface PenState {
  recognition: boolean;
  haptics: boolean;
}

/** Ask the bridge; a failed probe counts as "not here", as the ink page treats it. */
async function probe(ask: (() => Promise<boolean>) | undefined): Promise<boolean> {
  if (typeof ask !== "function") return false;
  try {
    return await ask();
  } catch {
    return false;
  }
}

/**
 * Settings → Editor, desktop app only: whether handwriting can be turned into
 * text on this machine (and why not), and the pen haptics switch.
 */
export function PenSettingsSection() {
  const bridge = desktop();
  const [state, setState] = useState<PenState | null>(null);
  const [hapticsOn, setHapticsOn] = useState(true);

  useEffect(() => {
    setHapticsOn(readInkHapticsOn());
    if (!bridge || typeof bridge.inkAvailable !== "function") return;
    let live = true;
    void Promise.all([
      probe(bridge.inkAvailable.bind(bridge)),
      probe(bridge.inkHapticsAvailable?.bind(bridge)),
    ]).then(([recognition, haptics]) => live && setState({ recognition, haptics }));
    return () => {
      live = false;
    };
  }, [bridge]);

  if (!state) return null;

  return (
    <section aria-labelledby="settings-pen-title">
      <h3 id="settings-pen-title" className="settings-group">
        Pen and handwriting
      </h3>
      <p className="muted jump-to-meta">
        {state.recognition
          ? "Handwriting recognition is ready. It runs on this computer through Windows' own recogniser."
          : "Handwriting recognition is not available on this computer: it needs the Windows handwriting recogniser, which this computer does not have or could not start."}
      </p>
      {state.haptics ? (
        <label className="calendar-feed-check">
          <input
            className="wf-check"
            type="checkbox"
            checked={hapticsOn}
            onChange={(event) => {
              setHapticsOn(event.target.checked);
              writeInkHapticsOn(event.target.checked);
            }}
          />
          Pen haptics while drawing (applies from the next ink page you open)
        </label>
      ) : (
        <p className="muted jump-to-meta">Pen haptics are not available: this Windows version or pen has none.</p>
      )}
    </section>
  );
}
