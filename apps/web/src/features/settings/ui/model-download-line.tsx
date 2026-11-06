"use client";

import { useEffect, useState } from "react";
import { desktop, type DesktopBridge } from "@/lib/desktop/desktop-bridge";

type Downloads = Pick<DesktopBridge, "modelDownloads" | "cancelModelDownloads">;
type Download = Awaited<ReturnType<NonNullable<DesktopBridge["modelDownloads"]>>>[number];

const POLL_MS = 500;
const MB = 1024 * 1024;

const mb = (bytes: number) => `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;

/** "12 MB of 90 MB", or just the bytes so far when the size is unknown. */
export function downloadText(downloads: Download[]): string {
  const done = downloads.reduce((sum, d) => sum + d.done, 0);
  const known = downloads.every((d) => d.total !== null);
  const total = downloads.reduce((sum, d) => sum + (d.total ?? 0), 0);
  return known && total > 0 ? `${mb(done)} of ${mb(total)}` : `${mb(done)} so far`;
}

/**
 * The model's bytes so far while the desktop shell downloads it, with a Cancel that stops it.
 * A stopped download keeps what it has; turning meaning search on again resumes it.
 */
export function ModelDownloadLine({ bridge = desktop() }: { bridge?: Downloads | null }) {
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [stopping, setStopping] = useState(false);
  const list = bridge?.modelDownloads;

  useEffect(() => {
    if (!list) return;
    let live = true;
    const poll = () =>
      list
        .call(bridge)
        .then((next) => live && setDownloads(next))
        .catch(() => {});
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [bridge, list]);

  if (!bridge?.cancelModelDownloads || downloads.length === 0) return null;
  const cancel = () => {
    setStopping(true);
    bridge.cancelModelDownloads!().catch(() => setStopping(false));
  };
  return (
    <p className="muted model-download-line">
      {downloadText(downloads)}{" "}
      <button type="button" className="btn btn-ghost btn-sm" onClick={cancel} disabled={stopping}>
        {stopping ? "Stopping…" : "Cancel"}
      </button>
    </p>
  );
}
