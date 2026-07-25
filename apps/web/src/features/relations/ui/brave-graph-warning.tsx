"use client";

import { useEffect, useState } from "react";

/**
 * Brave's fingerprint protection ("farbling") adds noise to canvas
 * `getImageData` readback. react-force-graph resolves clicks by reading a pixel
 * of an offscreen buffer and matching its colour exactly, so with Shields up the
 * graph renders fine but nodes/edges become unclickable. Warn Brave users.
 */
export function BraveGraphWarning() {
  const [isBrave, setIsBrave] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const brave = (navigator as unknown as { brave?: { isBrave?: () => Promise<boolean> } }).brave;
    let alive = true;
    brave?.isBrave?.().then((b) => {
      if (!alive) return;
      setIsBrave(b);
      setDismissed(localStorage.getItem("thesis.graph.braveWarnDismissed") === "1");
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!isBrave || dismissed) return null;

  return (
    <div className="brave-graph-warning" role="alert">
      <span>
        <strong>Brave detected.</strong> Shields block the canvas reads this graph uses for
        clicks — nodes won&apos;t be selectable. Click the Brave <em>Shields</em> icon and set
        <em> Fingerprinting → Allow</em> (or lower Shields) for this site.
      </span>
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          localStorage.setItem("thesis.graph.braveWarnDismissed", "1");
          setDismissed(true);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
